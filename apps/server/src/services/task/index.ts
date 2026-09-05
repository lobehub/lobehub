import { randomUUID } from 'node:crypto';

import { UNFINISHED_TASK_STATUSES } from '@lobechat/builtin-tool-task';
import { TASK_ASSIGNEE_PERMISSION_CODES } from '@lobechat/const/rbac';
import type {
  TaskContext,
  TaskDetailActivity,
  TaskDetailActivityAuthor,
  TaskDetailData,
  TaskDetailSubtask,
  TaskDetailWorkspaceNode,
  TaskItem,
  TaskSchedulerContext,
  TaskStatus,
  TaskTopicHandoff,
  WorkspaceData,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';

import { AgentModel } from '@/database/models/agent';
import { ProjectModel } from '@/database/models/project';
import { RbacModel } from '@/database/models/rbac';
import { isTaskIdentifierUniqueViolation, TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import { VerifyRunModel } from '@/database/models/verifyRun';
import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import type { LobeChatDatabase } from '@/database/type';

import { AiAgentService } from '../aiAgent';
import { extractFileIdsFromEditorData } from '../file/extractFileIdsFromEditorData';
import { resolveAttachmentMetadata } from '../file/resolveAttachments';
import { type SubtaskGraphPlan, TaskGraphService } from '../taskGraph';
import { type ReviewResult, TaskReviewService } from '../taskReview';
import { TaskRunnerService } from '../taskRunner';
import { createTaskSchedulerModule } from '../taskScheduler';
import { resolveTaskAcceptance } from '../verify/taskAcceptance';

const emptyWorkspace: WorkspaceData = { nodeMap: {}, tree: [] };
const UNTITLED_TOPIC_TITLE = 'Untitled';
const TASK_DETAIL_DIRECT_TOPIC_LIMIT = 100;
const TASK_DETAIL_DESCENDANT_TOPIC_LIMIT = 300;

type DirectTaskTopicActivityRow = Awaited<ReturnType<TaskTopicModel['findWithHandoff']>>[number];
type DescendantTaskTopicActivityRow = Awaited<
  ReturnType<TaskTopicModel['findWithHandoffByTaskIds']>
>[number];
type TaskTopicActivityRow = DirectTaskTopicActivityRow &
  Partial<
    Pick<
      DescendantTaskTopicActivityRow,
      'sourceTaskAssigneeAgentId' | 'sourceTaskId' | 'sourceTaskIdentifier' | 'sourceTaskName'
    >
  >;

export interface CreateTaskInput {
  assigneeAgentId?: string;
  assigneeUserId?: string;
  automationMode?: 'heartbeat' | 'schedule';
  config?: Record<string, unknown>;
  // Runtime-state pockets stored on the task row (tasks.context JSONB). Used at
  // creation to record `context.origin` — the creator conversation pointer.
  context?: TaskContext;
  createdByAgentId?: string;
  description?: string;
  editorData?: unknown;
  fileIds?: string[];
  identifierPrefix?: string;
  instruction: string;
  name?: string;
  parentTaskId?: string;
  priority?: number;
  projectId?: string;
  schedulePattern?: string;
  scheduleTimezone?: string;
  sortOrder?: number;
  // Explicit visibility for the new task. When omitted, the service derives it
  // from `parentTaskId` (if present) or `assigneeAgentId`'s visibility, and
  // finally falls back to the schema default ('public').
  visibility?: 'private' | 'public';
}

export interface UpdateStatusResult {
  allSubtasksDone?: boolean;
  checkpointTriggered?: boolean;
  parentTaskId?: string | null;
  paused: string[];
  task: TaskItem;
  unlocked: string[];
}

export interface UpdateStatusCascadeResult {
  paused: string[];
  task: TaskItem;
  unlocked: string[];
  updatedSubtasks: string[];
}

export interface RunReadySubtasksResult {
  failed: { error: string; identifier: string }[];
  kickedOff: string[];
  plan: SubtaskGraphPlan;
  skipped?: { reason: 'nothing-runnable' };
}

export class TaskService {
  private agentModel: AgentModel;
  private db: LobeChatDatabase;
  private taskModel: TaskModel;
  private projectModel: ProjectModel;
  private taskTopicModel: TaskTopicModel;
  private topicModel: TopicModel;
  private userId: string;

  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
    this.agentModel = new AgentModel(db, userId, workspaceId);
    this.projectModel = new ProjectModel(db, userId, workspaceId);
    this.taskModel = new TaskModel(db, userId, workspaceId);
    this.taskTopicModel = new TaskTopicModel(db, userId, workspaceId);
    this.topicModel = new TopicModel(db, userId, workspaceId);
  }

  /**
   * Create a task. Validates the assignee belongs to the user, resolves
   * `parentTaskId` if it's an identifier, and snapshots the assignee agent's
   * current model/provider into `task.config` so later changes to the agent's
   * default model don't silently affect this task.
   */
  async createTask(input: CreateTaskInput): Promise<TaskItem> {
    await this.assertAssigneeAgentBelongsToUser(input.assigneeAgentId);

    const taskInput = input;
    const createData: CreateTaskInput & { config?: Record<string, unknown> } = {
      ...taskInput,
    };

    let parentVisibility: 'private' | 'public' | undefined;
    if (createData.parentTaskId) {
      const parent = await this.resolveOrThrow(createData.parentTaskId);
      createData.parentTaskId = parent.id;
      parentVisibility = parent.visibility;
      if (createData.projectId && createData.projectId !== parent.projectId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Subtask must belong to the same project as its parent',
        });
      }
      createData.projectId ??= parent.projectId ?? undefined;
    }

    if (createData.projectId) {
      const project = await this.projectModel.findManageableById(createData.projectId);
      if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
      createData.identifierPrefix ??= project.identifier;
    }

    // Pull the model/provider snapshot and the agent's visibility in a single
    // SQL — both are needed for the same `tasks.create` row, and a second
    // round-trip would just retrace the same primary-key path.
    let agentVisibility: 'private' | 'public' | null = null;
    if (input.assigneeAgentId) {
      const agentInfo = await this.agentModel.getAgentSnapshotForTaskCreate(input.assigneeAgentId);
      if (agentInfo) {
        if (agentInfo.snapshot) createData.config = { ...agentInfo.snapshot, ...createData.config };
        agentVisibility = agentInfo.visibility;
      }
    }

    // Resolve visibility precedence: explicit caller value > parent task
    // (subtasks inherit) > assignee agent (private agent → private task) >
    // schema default ('public').
    if (createData.visibility === undefined) {
      if (parentVisibility) {
        createData.visibility = parentVisibility;
      } else if (agentVisibility === 'private') {
        createData.visibility = 'private';
      }
    }

    // Invariant: a public task can never be executed by a private agent. The
    // explicit-override branch above can produce this combination if the
    // caller passes `visibility='public'` while picking a private agent, so
    // we have to assert here even though the inference path can't.
    this.assertAgentVisibilityCompat(createData.visibility, agentVisibility);

    // Invariant: a private task can only be assigned to its creator — the
    // resolved visibility (explicit, inherited, or agent-derived) is what
    // counts, so this must run after the precedence chain above.
    this.assertAssigneeUserVisibilityCompat(
      createData.visibility,
      createData.assigneeUserId,
      this.userId,
    );

    // Invariant: a subtask can never be more public than its parent.
    // Otherwise workspace members see an orphaned child whose parent is
    // hidden, leaking the existence of a private task. The inference path
    // already inherits parent visibility, but the explicit-override path can
    // produce a `Private parent + Public child` combo if the caller insists.
    this.assertParentVisibilityCompat(createData.visibility, parentVisibility);

    const task = await this.createTaskWithAssigneeLock(createData);

    return task;
  }

  /**
   * Enforces the invariant: a subtask cannot be more public than its parent.
   * Promotion lattice is `private ≤ public`; child visibility ≤ parent
   * visibility. Throws `BAD_REQUEST` on violation. No constraint when there
   * is no parent.
   */
  assertParentVisibilityCompat(
    childVisibility: 'private' | 'public' | undefined,
    parentVisibility: 'private' | 'public' | undefined,
  ): void {
    if (parentVisibility !== 'private') return;
    if (childVisibility !== 'public') return;
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message:
        'A subtask cannot be more public than its parent. Promote the parent task first, or make this subtask private.',
    });
  }

  /**
   * Enforces the invariant: a public task must never be assigned to a private
   * agent. Throws `BAD_REQUEST` on violation. The reverse combination
   * (private task + public agent) is allowed by design — a workspace agent
   * may execute owner-only tasks without leaking, since task content stays
   * scoped to the creator via `ownership()`.
   *
   * `agentVisibility = null` means either no assignee or the agent could not
   * be resolved (e.g. caller cannot see it). In both cases the combo is
   * unconstrained because no private agent is actually involved.
   */
  assertAgentVisibilityCompat(
    taskVisibility: 'private' | 'public' | undefined,
    agentVisibility: 'private' | 'public' | null,
  ): void {
    if (taskVisibility !== 'public') return;
    if (agentVisibility !== 'private') return;
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message:
        'A public task cannot be assigned to a private agent. Either pick a workspace agent or make the task private first.',
    });
  }

  /**
   * Enforces the invariant: a private task can only be assigned to its
   * creator. A private task is visible to nobody else (ownership is
   * creator-based), so assigning another member would hand them a task they
   * can never see. Throws `BAD_REQUEST` on violation. Applies symmetrically
   * to assigning on a private task and to demoting a member-assigned task to
   * private.
   */
  assertAssigneeUserVisibilityCompat(
    taskVisibility: 'private' | 'public' | undefined,
    assigneeUserId: string | null | undefined,
    creatorUserId: string,
  ): void {
    if (!assigneeUserId) return;
    if (taskVisibility !== 'private') return;
    if (assigneeUserId === creatorUserId) return;
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message:
        'A private task can only be assigned to its creator. Unassign the member or keep the task visible to the workspace.',
    });
  }

  /**
   * Cancel a running topic: interrupt the remote operation (if any), then
   * mark the topic as `canceled` and pause its parent task.
   */
  async cancelTopic(topicId: string): Promise<void> {
    const target = await this.taskTopicModel.findByTopicId(topicId);
    if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'Topic not found.' });

    if (target.status !== 'running') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Topic is not running (current status: ${target.status}).`,
      });
    }

    if (target.operationId) {
      const aiAgentService = new AiAgentService(this.db, this.userId, {
        workspaceId: this.workspaceId,
      });
      await aiAgentService.interruptTask({ operationId: target.operationId });
    }

    await this.taskTopicModel.updateStatus(target.taskId, topicId, 'canceled');
    await this.taskModel.updateStatus(target.taskId, 'paused');
  }

  /**
   * Delete a topic: interrupt if still running, then remove the task-topic
   * link and delete the underlying topic.
   */
  async deleteTopic(topicId: string): Promise<void> {
    const target = await this.taskTopicModel.findByTopicId(topicId);
    if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'Topic not found.' });

    if (target.status === 'running' && target.operationId) {
      const aiAgentService = new AiAgentService(this.db, this.userId, {
        workspaceId: this.workspaceId,
      });
      await aiAgentService.interruptTask({ operationId: target.operationId });
    }

    await this.taskTopicModel.remove(target.taskId, topicId);
    await this.topicModel.delete(topicId);
  }

  /**
   * Run the configured review on `content`, persist the result onto the
   * target topic, and return the review outcome.
   */
  async runReview(input: {
    content?: string;
    id: string;
    topicId?: string;
  }): Promise<ReviewResult> {
    const task = await this.resolveOrThrow(input.id);

    const reviewConfig = this.taskModel.getReviewConfig(task);
    if (!reviewConfig?.enabled) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Review is not enabled for this task',
      });
    }

    const content = input.content;
    if (!content) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Content is required for review. Pass --content or run after a topic completes.',
      });
    }

    const topicId = input.topicId || task.currentTopicId;

    let iteration = 1;
    if (topicId) {
      const topics = await this.taskTopicModel.findByTaskId(task.id);
      const target = topics.find((t) => t.topicId === topicId);
      if (target?.reviewIteration) iteration = target.reviewIteration + 1;
    }

    const reviewService = new TaskReviewService(this.db, this.userId, this.workspaceId);
    const result = await reviewService.review({
      content,
      iteration,
      judge: reviewConfig.judge,
      rubrics: reviewConfig.rubrics,
      taskName: task.name || task.identifier,
    });

    if (topicId) {
      await this.taskTopicModel.updateReview(task.id, topicId, {
        iteration,
        passed: result.passed,
        score: result.overallScore,
        scores: result.rubricResults,
      });
    }

    return result;
  }

  /**
   * Transition a task to a new status, cascading the side effects:
   *   - leaving `running`: interrupt + cancel still-running topics
   *   - entering `completed`: check parent checkpoint, count sibling
   *     completions, kick off any newly-unlocked downstream tasks.
   */
  async updateStatus(input: {
    error?: string;
    id: string;
    status: TaskStatus;
  }): Promise<UpdateStatusResult> {
    const { id, status, error: errorMsg } = input;

    if (errorMsg && status !== 'failed') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Task error can only be provided when status is failed.',
      });
    }

    const resolved = await this.resolveOrThrow(id);

    if (resolved.status === 'running' && status !== 'running') {
      const topics = await this.taskTopicModel.findByTaskId(resolved.id);
      const aiAgentService = new AiAgentService(this.db, this.userId, {
        workspaceId: this.workspaceId,
      });

      for (const t of topics) {
        if (t.status !== 'running' || !t.topicId) continue;

        // Interrupt the remote operation first; if it fails, skip cancellation
        // to avoid desynchronizing DB state from a still-running operation.
        if (t.operationId) {
          try {
            await aiAgentService.interruptTask({ operationId: t.operationId });
          } catch (err) {
            console.error(
              '[TaskService.updateStatus] failed to interrupt topic %s:',
              t.topicId,
              err,
            );
            continue;
          }
        }

        await this.taskTopicModel.cancelIfRunning(resolved.id, t.topicId);
      }
    }

    const extra: Record<string, unknown> = {};
    if (status === 'running') extra.startedAt = new Date();
    if (status === 'completed' || status === 'failed' || status === 'canceled')
      extra.completedAt = new Date();
    if (errorMsg) extra.error = errorMsg;

    const task = await this.taskModel.updateStatus(resolved.id, status, extra);
    if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });

    // Stamp the schedule run-count window each time the user (re)starts a
    // scheduled task. The cron dispatcher itself flips a task running →
    // scheduled on every tick, so we exclude that natural cycle by only
    // resetting when the previous status was NOT 'running'. This lets
    // `runScheduleTick` enforce `config.schedule.maxExecutions` by counting
    // task_topics created since this timestamp.
    if (
      status === 'scheduled' &&
      task.automationMode === 'schedule' &&
      resolved.status !== 'running'
    ) {
      await this.taskModel.updateContext(task.id, {
        scheduler: { scheduleStartedAt: new Date().toISOString() },
      });
    }

    // Heartbeat ticks are one-shot delayed messages that re-arm themselves
    // after each run. Seed the very first message when a user starts/restarts
    // the schedule; otherwise a fresh heartbeat task has no event capable of
    // reaching the lifecycle re-arm path.
    if (
      status === 'scheduled' &&
      task.automationMode === 'heartbeat' &&
      task.heartbeatInterval &&
      task.heartbeatInterval > 0 &&
      resolved.status !== 'running' &&
      resolved.status !== 'scheduled'
    ) {
      const scheduler = createTaskSchedulerModule();
      const schedulerContext = (resolved.context as TaskContext | null)?.scheduler as
        TaskSchedulerContext | undefined;
      const previousTickMessageId = schedulerContext?.tickMessageId;
      const tickToken = randomUUID();
      let tickMessageId: string | undefined;

      try {
        // Invalidate the previous generation before publishing. This closes
        // the race where an old QStash delivery arrives while the replacement
        // message is being created.
        await this.taskModel.updateContext(task.id, { scheduler: { tickToken } });
        tickMessageId = await scheduler.scheduleNextTopic({
          delay: task.heartbeatInterval,
          taskId: task.id,
          tickToken,
          userId: this.userId,
        });

        await this.taskModel.updateContext(task.id, {
          scheduler: {
            consecutiveFailures: schedulerContext?.consecutiveFailures ?? 0,
            scheduledAt: new Date().toISOString(),
            tickMessageId,
            tickToken,
          },
        });
      } catch (error) {
        // Never expose a scheduled status without a persisted tick. Restore
        // the user-visible state and cancel a newly published message when
        // persistence was the failing step.
        if (tickMessageId) await scheduler.cancelScheduled(tickMessageId).catch(() => undefined);
        await this.taskModel.update(task.id, { context: resolved.context });
        await this.taskModel.updateStatus(task.id, resolved.status);
        throw error;
      }

      if (previousTickMessageId) {
        await scheduler.cancelScheduled(previousTickMessageId).catch(() => undefined);
      }
    }

    const unlocked: string[] = [];
    const paused: string[] = [];
    let allSubtasksDone = false;
    let checkpointTriggered = false;

    if (status === 'completed') {
      if (task.parentTaskId) {
        const parentTask = await this.taskModel.findById(task.parentTaskId);
        if (parentTask && this.taskModel.shouldPauseAfterComplete(parentTask, task.identifier)) {
          await this.taskModel.updateStatus(parentTask.id, 'paused');
          checkpointTriggered = true;
        }
        allSubtasksDone = await this.taskModel.areAllSubtasksCompleted(task.parentTaskId);
      }

      // Unlock blocked tasks and actually kick them off via the runner.
      const runner = new TaskRunnerService(this.db, this.userId, this.workspaceId);
      const cascade = await runner.cascadeOnCompletion(task.id);
      unlocked.push(...cascade.started);
      paused.push(...cascade.paused);
    }

    return {
      paused,
      task,
      unlocked,
      ...(checkpointTriggered && { checkpointTriggered: true }),
      ...(allSubtasksDone && { allSubtasksDone: true, parentTaskId: task.parentTaskId }),
    };
  }

  /**
   * Transition a parent and every currently unfinished direct subtask as one
   * database transaction. Completion side effects run only after the whole
   * family has reached the target status, so dependency edges cannot start a
   * sibling in the middle of the cascade.
   */
  async updateStatusCascade(input: {
    id: string;
    status: 'canceled' | 'completed';
  }): Promise<UpdateStatusCascadeResult> {
    const resolved = await this.resolveOrThrow(input.id);
    const subtasks = await this.taskModel.findSubtasks(resolved.id);
    const unfinishedStatuses = new Set<string>(UNFINISHED_TASK_STATUSES);
    const openSubtasks = subtasks.filter((task) => unfinishedStatuses.has(task.status));
    // Freeze the cascade to this snapshot: both the interrupt pass and the
    // status update operate on the same id set, so a subtask created or
    // transitioned after the confirmation dialog is never rewritten.
    const targetTasks = [resolved, ...openSubtasks];
    const targetIds = targetTasks.map((task) => task.id);

    const aiAgentService = new AiAgentService(this.db, this.userId, {
      workspaceId: this.workspaceId,
    });

    const runningTopics = await this.taskTopicModel.findRunningByTaskIds(targetIds);
    if (runningTopics.length > 0) {
      const settled = await Promise.allSettled(
        runningTopics.map(async (topic) => {
          if (topic.operationId) {
            await aiAgentService.interruptTask({ operationId: topic.operationId });
          }
        }),
      );
      const failure = settled.find((result) => result.status === 'rejected');
      if (failure) {
        // Persist the interrupts that did succeed before surfacing the error,
        // so an actually-stopped operation is not left recorded as running.
        for (const [index, topic] of runningTopics.entries()) {
          if (settled[index].status !== 'fulfilled' || !topic.topicId) continue;
          await this.taskTopicModel
            .cancelIfRunning(topic.taskId, topic.topicId)
            .catch(() => undefined);
        }
        throw failure.reason;
      }
    }

    const completedAt = new Date();
    let updatedTasks: TaskItem[] = [];
    let canceledTopics: Awaited<ReturnType<TaskTopicModel['cancelRunningByTaskIds']>> = [];
    await this.db.transaction(async (tx) => {
      const taskModel = new TaskModel(tx, this.userId, this.workspaceId);
      const taskTopicModel = new TaskTopicModel(tx, this.userId, this.workspaceId);

      // Cancel by the frozen id set rather than the pre-read topic list, so a
      // topic that started between the snapshot and this transaction is still
      // closed together with the status update.
      canceledTopics = await taskTopicModel.cancelRunningByTaskIds(targetIds);
      updatedTasks = await taskModel.updateStatusForIds(targetIds, input.status, { completedAt });
    });

    // Best-effort: stop any operation discovered only inside the transaction.
    const interruptedOperationIds = new Set(runningTopics.map((topic) => topic.operationId));
    await Promise.allSettled(
      canceledTopics
        .filter((topic) => topic.operationId && !interruptedOperationIds.has(topic.operationId))
        .map((topic) => aiAgentService.interruptTask({ operationId: topic.operationId! })),
    );

    const task = updatedTasks.find(({ id }) => id === resolved.id);
    if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });

    const unlocked: string[] = [];
    const paused: string[] = [];
    if (input.status === 'completed') {
      const runner = new TaskRunnerService(this.db, this.userId, this.workspaceId);
      const cascade = await runner.cascadeOnCompletionMany(updatedTasks.map(({ id }) => id));
      unlocked.push(...cascade.started);
      paused.push(...cascade.paused);
    }

    return {
      paused,
      task,
      unlocked,
      updatedSubtasks: updatedTasks
        .filter(({ parentTaskId }) => parentTaskId === resolved.id)
        .map(({ identifier }) => identifier),
    };
  }

  /**
   * Compute the subtask execution plan for `idOrIdentifier` without
   * actually kicking anything off.
   */
  async previewSubtaskLayers(idOrIdentifier: string): Promise<SubtaskGraphPlan> {
    const parent = await this.resolveOrThrow(idOrIdentifier);
    const graph = new TaskGraphService(this.db, this.userId, this.workspaceId);
    const { plan } = await graph.planForParent(parent.id);
    return plan;
  }

  /**
   * Kick off the first runnable layer of subtasks under `idOrIdentifier`.
   * Subsequent layers fire automatically through
   * `TaskRunnerService.cascadeOnCompletion` as each upstream finishes.
   */
  async runReadySubtasks(idOrIdentifier: string): Promise<RunReadySubtasksResult> {
    const parent = await this.resolveOrThrow(idOrIdentifier);
    const graph = new TaskGraphService(this.db, this.userId, this.workspaceId);
    const { descendants, plan } = await graph.planForParent(parent.id);

    if (plan.layers.length === 0) {
      return {
        failed: [],
        kickedOff: [],
        plan,
        skipped: { reason: 'nothing-runnable' as const },
      };
    }

    const firstLayer = plan.layers[0];
    const identifierToId = new Map(descendants.map((d) => [d.identifier, d.id]));
    const runner = new TaskRunnerService(this.db, this.userId, this.workspaceId);

    const kickedOff: string[] = [];
    const failed: { error: string; identifier: string }[] = [];

    const settled = await Promise.allSettled(
      firstLayer.map(async (identifier) => {
        const id = identifierToId.get(identifier);
        if (!id) throw new Error(`Subtask ${identifier} not found`);
        await runner.runTask({ taskId: id });
        return identifier;
      }),
    );

    for (const [index, result] of settled.entries()) {
      const identifier = firstLayer[index];
      if (result.status === 'fulfilled') {
        kickedOff.push(identifier);
      } else {
        const message =
          result.reason instanceof Error ? result.reason.message : 'Failed to start task';
        failed.push({ error: message, identifier });
      }
    }

    return { failed, kickedOff, plan };
  }

  private async assertAssigneeAgentBelongsToUser(assigneeAgentId?: string | null): Promise<void> {
    if (!assigneeAgentId) return;
    // `existsById` already applies the workspace + visibility predicate, so a
    // cross-user private agent never resolves. NOT_FOUND (not BAD_REQUEST or
    // FORBIDDEN) keeps every private-agent leak path returning the same code.
    const exists = await this.agentModel.existsById(assigneeAgentId);
    if (!exists) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Assignee agent not found' });
    }
  }

  /**
   * A task can only be assigned to a human who can actually see it: an active
   * member of the current workspace, or the caller themself in personal mode.
   * NOT_FOUND (not FORBIDDEN) mirrors the agent-assignee path so membership of
   * other workspaces is never leaked.
   */
  async assertAssigneeUserAssignable(assigneeUserId?: string | null): Promise<void> {
    await this.assertAssigneeUserAssignableWithDatabase(this.db, assigneeUserId);
  }

  private async assertAssigneeUserAssignableWithDatabase(
    db: LobeChatDatabase,
    assigneeUserId?: string | null,
    lockMember = false,
  ): Promise<void> {
    if (!assigneeUserId) return;

    if (!this.workspaceId) {
      if (assigneeUserId !== this.userId) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Assignee user not found',
        });
      }
      return;
    }

    const memberModel = new WorkspaceMemberModel(db, this.userId);
    const member = lockMember
      ? await memberModel.getMemberForUpdate(this.workspaceId, assigneeUserId)
      : await memberModel.getMember(this.workspaceId, assigneeUserId);
    if (!member) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Assignee user is not a member of this workspace',
      });
    }

    const canManageTasks = await new RbacModel(db, assigneeUserId).hasAnyPermission(
      [...TASK_ASSIGNEE_PERMISSION_CODES],
      { userId: assigneeUserId, workspaceId: this.workspaceId },
    );
    if (!canManageTasks) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Assignee user cannot manage tasks in this workspace',
      });
    }
  }

  private async withAssigneeUserLock<T>(
    assigneeUserId: string | null | undefined,
    write: (db: LobeChatDatabase) => Promise<T>,
  ): Promise<T> {
    if (!assigneeUserId || !this.workspaceId) {
      await this.assertAssigneeUserAssignableWithDatabase(this.db, assigneeUserId);
      return write(this.db);
    }

    return this.db.transaction(async (tx) => {
      await this.assertAssigneeUserAssignableWithDatabase(tx, assigneeUserId, true);
      return write(tx);
    });
  }

  private async createTaskWithAssigneeLock(
    createData: CreateTaskInput & { config?: Record<string, unknown> },
  ): Promise<TaskItem> {
    if (!createData.assigneeUserId || !this.workspaceId) {
      await this.assertAssigneeUserAssignable(createData.assigneeUserId);
      return this.taskModel.create(createData);
    }

    // TaskModel's normal retry loop cannot continue after a unique violation
    // inside an open Postgres transaction. Retry the whole lock + validation +
    // insert transaction instead so concurrent identifier allocation remains
    // safe while the membership row stays serialized with the write.
    const maxRetries = 5;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.withAssigneeUserLock(createData.assigneeUserId, (db) =>
          new TaskModel(db, this.userId, this.workspaceId).create(createData, { maxRetries: 1 }),
        );
      } catch (error) {
        if (!isTaskIdentifierUniqueViolation(error) || attempt === maxRetries - 1) throw error;
      }
    }

    throw new Error('Failed to create task after max retries');
  }

  async updateTaskWithAssigneeLock(
    taskId: string,
    data: Parameters<TaskModel['update']>[1],
  ): Promise<TaskItem | null> {
    return this.withAssigneeUserLock(data.assigneeUserId, (db) =>
      new TaskModel(db, this.userId, this.workspaceId).update(taskId, data),
    );
  }

  private async resolveOrThrow(idOrIdentifier: string): Promise<TaskItem> {
    const task = await this.taskModel.resolve(idOrIdentifier);
    if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
    return task;
  }

  async getTaskDetail(taskIdOrIdentifier: string): Promise<TaskDetailData | null> {
    let task = await this.taskModel.resolve(taskIdOrIdentifier);
    if (!task) return null;

    // Auto-detect heartbeat timeout for running tasks before assembling detail.
    if (task.status === 'running' && task.heartbeatTimeout && task.lastHeartbeatAt) {
      const elapsed = (Date.now() - new Date(task.lastHeartbeatAt).getTime()) / 1000;
      if (elapsed > task.heartbeatTimeout) {
        await this.taskModel.updateStatus(task.id, 'paused', { error: 'Heartbeat timeout' });
        await this.taskTopicModel.timeoutRunning(task.id);
        task = await this.taskModel.resolve(taskIdOrIdentifier);
        if (!task) return null;
      }
    }

    // Clear stale heartbeat timeout error once the task is no longer running.
    if (task.status !== 'running' && task.error === 'Heartbeat timeout') {
      await this.taskModel.update(task.id, { error: null });
      task = { ...task, error: null };
    }

    // Brief hidden: the task detail activity feed no longer carries
    // brief-type activities — the UI converges on Task Run. Briefs are therefore
    // not fetched/enriched here (see the omitted brief spread below). The brief
    // lifecycle, model and data are untouched; revert this to bring them back.
    const [allDescendants, dependencies, directTopics, comments, workspace, acceptance] =
      await Promise.all([
        this.taskModel.findAllDescendants(task.id),
        this.taskModel.getDependencies(task.id),
        this.taskTopicModel
          .findWithHandoff(task.id, TASK_DETAIL_DIRECT_TOPIC_LIMIT)
          .catch(() => []),
        this.taskModel.getComments(task.id).catch(() => []),
        this.taskModel.getTreePinnedDocuments(task.id).catch(() => emptyWorkspace),
        resolveTaskAcceptance(this.db, this.userId, task.id, this.workspaceId).catch(
          () => undefined,
        ),
      ]);

    const allDescendantIds = allDescendants.map((s) => s.id);
    const descendantTaskMap = new Map(allDescendants.map((s) => [s.id, s]));
    const descendantTopics =
      allDescendantIds.length > 0
        ? await this.taskTopicModel
            .findWithHandoffByTaskIds(allDescendantIds, TASK_DETAIL_DESCENDANT_TOPIC_LIMIT)
            .catch(() => [])
        : [];

    const topics: TaskTopicActivityRow[] = [
      ...directTopics,
      ...descendantTopics.map((topic) => {
        const sourceTask = descendantTaskMap.get(topic.sourceTaskId);
        return {
          ...topic,
          sourceTaskAssigneeAgentId:
            topic.sourceTaskAssigneeAgentId ?? sourceTask?.assigneeAgentId ?? null,
          sourceTaskId: topic.sourceTaskId ?? sourceTask?.id ?? null,
          sourceTaskIdentifier: topic.sourceTaskIdentifier ?? sourceTask?.identifier ?? null,
          sourceTaskName: topic.sourceTaskName ?? sourceTask?.name ?? null,
        };
      }),
    ];

    // Derive fileIds from persisted editor_data (single source of truth).
    const extractCtx = { db: this.db, userId: this.userId, workspaceId: this.workspaceId };
    const [taskFileIds, ...commentFileIdLists] = await Promise.all([
      extractFileIdsFromEditorData(task.editorData, extractCtx),
      ...comments.map((c) => extractFileIdsFromEditorData(c.editorData, extractCtx)),
    ]);
    const commentFileIdsMap: Record<string, string[]> = {};
    comments.forEach((c, i) => {
      const ids = commentFileIdLists[i];
      if (ids.length > 0) commentFileIdsMap[c.id] = ids;
    });

    const allFileIds = [...taskFileIds, ...Object.values(commentFileIdsMap).flat()];
    const allFileMetadata = await resolveAttachmentMetadata({
      db: this.db,
      fileIds: allFileIds,
      userId: this.userId,
      workspaceId: this.workspaceId,
    });
    const fileById = new Map(allFileMetadata.map((f) => [f.id, f]));
    const taskFiles = taskFileIds.map((id) => fileById.get(id)).filter((f) => !!f);

    const [allDescendantDeps, allDescendantTopics] =
      allDescendantIds.length > 0
        ? await Promise.all([
            this.taskModel.getDependenciesByTaskIds(allDescendantIds).catch(() => []),
            this.taskTopicModel.findRunningByTaskIds(allDescendantIds).catch(() => []),
          ])
        : [[], []];

    // Build dependency map for all descendants
    const idToIdentifier = new Map(allDescendants.map((s) => [s.id, s.identifier]));
    const depMap = new Map<string, string>();
    for (const dep of allDescendantDeps) {
      const depId = idToIdentifier.get(dep.dependsOnId);
      if (depId) depMap.set(dep.taskId, depId);
    }

    const runningTopicByTaskId = new Map<string, (typeof allDescendantTopics)[number]>();
    for (const topic of allDescendantTopics) {
      if (!runningTopicByTaskId.has(topic.taskId)) runningTopicByTaskId.set(topic.taskId, topic);
    }

    // Build nested subtask tree
    const childrenMap = new Map<string, typeof allDescendants>();
    for (const t of allDescendants) {
      const parentId = t.parentTaskId!;
      if (!childrenMap.has(parentId)) childrenMap.set(parentId, []);
      childrenMap.get(parentId)!.push(t);
    }

    // Resolve subtask assignee agents in batch so the UI can render avatars
    // without depending on client-side agent store state.
    const subtaskAssigneeIds = [
      ...new Set(
        allDescendants.map((s) => s.assigneeAgentId).filter((id): id is string => Boolean(id)),
      ),
    ];
    const subtaskAgents =
      subtaskAssigneeIds.length > 0
        ? await this.agentModel.getAgentAvatarsByIds(subtaskAssigneeIds)
        : [];
    const subtaskAgentMap = new Map(subtaskAgents.map((a) => [a.id, a]));

    const buildSubtaskTree = (parentId: string): TaskDetailSubtask[] | undefined => {
      const children = childrenMap.get(parentId);
      if (!children || children.length === 0) return undefined;
      return children.map((s) => {
        const agent = s.assigneeAgentId ? subtaskAgentMap.get(s.assigneeAgentId) : undefined;
        const runningTopic = runningTopicByTaskId.get(s.id);
        return {
          ...(agent
            ? {
                assignee: {
                  avatar: agent.avatar,
                  backgroundColor: agent.backgroundColor,
                  id: agent.id,
                  title: agent.title,
                },
              }
            : {}),
          assigneeUserId: s.assigneeUserId,
          automationMode: s.automationMode,
          blockedBy: depMap.get(s.id),
          createdByUserId: s.createdByUserId,
          visibility: s.visibility,
          children: buildSubtaskTree(s.id),
          ...(s.heartbeatInterval != null ? { heartbeat: { interval: s.heartbeatInterval } } : {}),
          identifier: s.identifier,
          name: s.name,
          priority: s.priority,
          ...(runningTopic?.topicId
            ? {
                runningTopic: {
                  id: runningTopic.topicId,
                  operationId: runningTopic.operationId ?? null,
                },
              }
            : {}),
          ...(s.schedulePattern || s.scheduleTimezone
            ? { schedule: { pattern: s.schedulePattern, timezone: s.scheduleTimezone } }
            : {}),
          status: s.status,
          updatedAt: s.updatedAt ? new Date(s.updatedAt).toISOString() : undefined,
        };
      });
    };

    // Root level: always return array (empty [] when no subtasks) for consistent API shape
    const subtasks = buildSubtaskTree(task.id) ?? [];

    // Resolve dependency task identifiers
    const depTaskIds = [...new Set(dependencies.map((d) => d.dependsOnId))];
    const depTasks = await this.taskModel.findByIds(depTaskIds);
    const depIdToInfo = new Map(
      depTasks.map((t) => [t.id, { identifier: t.identifier, name: t.name }]),
    );

    // Resolve parent
    let parent: { agentId: string | null; identifier: string; name: string | null } | null = null;
    if (task.parentTaskId) {
      const parentTask = await this.taskModel.findById(task.parentTaskId);
      if (parentTask) {
        parent = {
          agentId: parentTask.assigneeAgentId,
          identifier: parentTask.identifier,
          name: parentTask.name,
        };
      }
    }

    // Build workspace tree (recursive)
    const buildWorkspaceNodes = (treeNodes: typeof workspace.tree): TaskDetailWorkspaceNode[] =>
      treeNodes.map((node) => {
        const doc = workspace.nodeMap[node.id];
        return {
          children: node.children.length > 0 ? buildWorkspaceNodes(node.children) : undefined,
          createdAt: doc?.createdAt ? new Date(doc.createdAt).toISOString() : undefined,
          documentId: node.id,
          fileType: doc?.fileType,
          inaccessible: doc?.inaccessible,
          size: doc?.charCount,
          sourceTaskId: doc?.sourceTaskId,
          sourceTaskIdentifier: doc?.sourceTaskIdentifier,
          title: doc?.title,
        };
      });

    const workspaceFolders = buildWorkspaceNodes(workspace.tree);

    // Build activities (merged & sorted desc by time)
    const toISO = (d: Date | string | null | undefined) =>
      d ? new Date(d).toISOString() : undefined;

    // Collect unique agent/user IDs for author resolution
    const agentIds = new Set<string>();
    const userIds = new Set<string>();

    // Each topic keeps the agent that actually ran it (topics.agentId), so an
    // earlier run's avatar stays correct after the task is reassigned. Fall back
    // to the source task assignee, then the current task assignee, only when a
    // topic has no recorded agent.
    for (const t of topics) {
      const topicAgentId = t.agentId ?? t.sourceTaskAssigneeAgentId ?? task.assigneeAgentId;
      if (topicAgentId) agentIds.add(topicAgentId);
    }
    // Comments have authorAgentId or authorUserId
    for (const c of comments) {
      if (c.authorAgentId) agentIds.add(c.authorAgentId);
      if (c.authorUserId) userIds.add(c.authorUserId);
    }
    // Creator of the task itself (agent takes precedence over user)
    if (task.createdByAgentId) agentIds.add(task.createdByAgentId);
    else if (task.createdByUserId) userIds.add(task.createdByUserId);

    const authorMap = await this.resolveAuthors(agentIds, userIds);

    // Every run row answers "and did it pass?" on its own (with counts). Without this the
    // activity feed lists rounds that all look alike, and the only way to learn
    // a round's verdict is to leave for the acceptance page.
    const verifyByOperation = await new VerifyRunModel(this.db, this.userId, this.workspaceId)
      .findByOperations(topics.map((t) => t.operationId).filter((id): id is string => Boolean(id)))
      .catch(() => new Map());

    const creatorId = task.createdByAgentId ?? task.createdByUserId;
    const createdActivity: TaskDetailActivity | null =
      task.createdAt && creatorId
        ? {
            author: authorMap.get(creatorId),
            time: toISO(task.createdAt),
            type: 'created' as const,
          }
        : null;

    const activities: TaskDetailActivity[] = [
      ...(createdActivity ? [createdActivity] : []),
      ...topics.map((t) => {
        const handoff = t.handoff as TaskTopicHandoff | null;
        const topicAgentId = t.agentId ?? t.sourceTaskAssigneeAgentId ?? task.assigneeAgentId;
        const verifyRun = t.operationId ? verifyByOperation.get(t.operationId) : undefined;
        return {
          author: topicAgentId ? authorMap.get(topicAgentId) : undefined,
          completedAt: toISO(t.completedAt),
          cost: t.totalCost == null ? null : Number(t.totalCost),
          // Raw last assistant message of the run, shown alongside
          // the synthesized summary on the run card.
          content: handoff?.content,
          id: t.topicId ?? undefined,
          operationId: t.operationId ?? null,
          runningOperation: t.metadata?.runningOperation ?? null,
          seq: t.seq,
          status: t.status,
          summary: handoff?.summary,
          sourceTaskId: t.sourceTaskId,
          sourceTaskIdentifier: t.sourceTaskIdentifier,
          sourceTaskName: t.sourceTaskName,
          time: toISO(t.createdAt),
          title: handoff?.title || t.title || UNTITLED_TOPIC_TITLE,
          // What opened this round. Without it the feed cannot distinguish a run
          // the user started from one the goal coordinator / scheduler opened on its
          // own — they render identically apart from `#seq`.
          trigger: t.trigger ?? null,
          verify: verifyRun
            ? {
                acceptanceId: verifyRun.acceptanceId,
                passed: verifyRun.passed,
                roundIndex: verifyRun.roundIndex,
                runId: verifyRun.id,
                status: verifyRun.status,
                total: verifyRun.total,
              }
            : null,
          type: 'topic' as const,
        };
      }),
      // Brief activities intentionally omitted — see the fetch note above.
      ...comments.map((c) => {
        const ids = commentFileIdsMap[c.id] ?? [];
        const files = ids.map((id) => fileById.get(id)).filter((f) => !!f);
        return {
          agentId: c.authorAgentId,
          author: c.authorAgentId
            ? authorMap.get(c.authorAgentId)
            : c.authorUserId
              ? authorMap.get(c.authorUserId)
              : undefined,
          content: c.content,
          editorData: c.editorData ?? undefined,
          files: files.length > 0 ? files : undefined,
          id: c.id,
          time: toISO(c.createdAt),
          type: 'comment' as const,
        };
      }),
    ].sort((a, b) => {
      if (!a.time) return 1;
      if (!b.time) return -1;
      return a.time.localeCompare(b.time);
    });

    const taskConfig = task.config ? (task.config as Record<string, unknown>) : undefined;
    const taskContext = task.context ? (task.context as TaskContext) : undefined;
    const scheduleConfig = (taskConfig?.schedule ?? {}) as { maxExecutions?: number | null };

    return {
      agentId: task.assigneeAgentId,
      automationMode: task.automationMode ?? null,
      checkpoint: this.taskModel.getCheckpointConfig(task),
      config: taskConfig,
      createdAt: task.createdAt ? new Date(task.createdAt).toISOString() : undefined,
      createdByUserId: task.createdByUserId,
      dependencies: dependencies.map((d) => {
        const info = depIdToInfo.get(d.dependsOnId);
        return {
          dependsOn: info?.identifier ?? d.dependsOnId,
          name: info?.name,
          type: d.type,
        };
      }),
      description: task.description,
      editorData: task.editorData ?? undefined,
      error: task.error,
      files: taskFiles.length > 0 ? taskFiles : undefined,
      heartbeat:
        task.heartbeatInterval || task.heartbeatTimeout || task.lastHeartbeatAt
          ? {
              interval: task.heartbeatInterval,
              lastAt: task.lastHeartbeatAt ? new Date(task.lastHeartbeatAt).toISOString() : null,
              scheduledAt: taskContext?.scheduler?.scheduledAt,
              timeout: task.heartbeatTimeout,
            }
          : undefined,
      id: task.id,
      identifier: task.identifier,
      instruction: task.instruction,
      name: task.name,
      parent,
      priority: task.priority,
      schedule:
        task.schedulePattern || task.scheduleTimezone || scheduleConfig.maxExecutions != null
          ? {
              maxExecutions: scheduleConfig.maxExecutions ?? null,
              pattern: task.schedulePattern,
              timezone: task.scheduleTimezone,
            }
          : undefined,
      startedAt: task.startedAt ? new Date(task.startedAt).toISOString() : undefined,
      status: task.status,
      userId: task.assigneeUserId,
      verify: acceptance
        ? { ...acceptance.config, requirement: acceptance.requirement }
        : this.taskModel.getVerifyConfig(task),
      visibility: task.visibility,
      subtasks,
      activities: activities.length > 0 ? activities : undefined,
      topicCount: topics.length > 0 ? topics.length : undefined,
      updatedAt: task.updatedAt ? new Date(task.updatedAt).toISOString() : undefined,
      workspace: workspaceFolders.length > 0 ? workspaceFolders : undefined,
      workspaceId: task.workspaceId ?? null,
    };
  }

  /**
   * Batch-resolve agent and user IDs to author info (name + avatar).
   */
  private async resolveAuthors(
    agentIds: Set<string>,
    userIds: Set<string>,
  ): Promise<Map<string, TaskDetailActivityAuthor>> {
    const map = new Map<string, TaskDetailActivityAuthor>();

    const [agentRows, userRows] = await Promise.all([
      this.agentModel.getAgentAvatarsByIds([...agentIds]),
      UserModel.findByIds(this.db, [...userIds]),
    ]);

    for (const a of agentRows) {
      map.set(a.id, { avatar: a.avatar, id: a.id, name: a.title, type: 'agent' });
    }
    for (const u of userRows) {
      map.set(u.id, { avatar: u.avatar, id: u.id, name: u.fullName, type: 'user' });
    }

    return map;
  }
}
