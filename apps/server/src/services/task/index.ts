import { randomUUID } from 'node:crypto';

import { UNFINISHED_TASK_STATUSES } from '@lobechat/builtin-tool-task';
import { TASK_ASSIGNEE_PERMISSION_CODES } from '@lobechat/const/rbac';
import type {
  TaskContext,
  TaskDetailData,
  TaskItem,
  TaskSchedulerContext,
  TaskStatus,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';

import { AgentModel } from '@/database/models/agent';
import { ProjectModel } from '@/database/models/project';
import { RbacModel } from '@/database/models/rbac';
import {
  isTaskIdentifierUniqueViolation,
  taskActivityActor,
  TaskModel,
} from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { TopicModel } from '@/database/models/topic';
import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import type { LobeChatDatabase } from '@/database/type';

import { AiAgentService } from '../aiAgent';
import { type SubtaskGraphPlan, TaskGraphService } from '../taskGraph';
import { type ReviewResult, TaskReviewService } from '../taskReview';
import { TaskRunnerService } from '../taskRunner';
import { createTaskSchedulerModule } from '../taskScheduler';
import { assertArchivedTaskStaysIdle, writeKeepingArchivedIdle } from './archiveGuard';
import { TaskDetailService } from './detail';
import { resolveMissingTaskModelConfig } from './modelSnapshot';

/** How long after a run starts a task may have no recorded operation yet. */
const TASK_RUN_STARTING_GRACE_MS = 2 * 60 * 1000;

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
  /** Completion was requested by the task's own run and lands when it ends. */
  completionDeferred?: boolean;
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
    }

    // Pull the model/provider snapshot and the agent's visibility in a single
    // SQL — both are needed for the same `tasks.create` row, and a second
    // round-trip would just retrace the same primary-key path.
    let agentVisibility: 'private' | 'public' | null = null;
    if (input.assigneeAgentId) {
      const agentInfo = await this.agentModel.getAgentSnapshotForTaskCreate(input.assigneeAgentId);
      if (agentInfo) {
        if (agentInfo.snapshot) {
          createData.config = {
            ...createData.config,
            ...resolveMissingTaskModelConfig(
              createData.config,
              agentInfo.snapshot,
              agentInfo.modelOverrideProvider,
            ),
          };
        }
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

  private interruptTaskOperation = async (service: AiAgentService, operationId: string) => {
    const result = await service.interruptTask({ operationId });
    if (!result.success || result.deviceCancellationConfirmed === false) {
      throw new TRPCError({
        code: 'CONFLICT',
        message:
          'Task interruption was not confirmed. The execution remains active; retry stopping it before starting another attempt.',
      });
    }
  };

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
      await this.interruptTaskOperation(aiAgentService, target.operationId);
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
      await this.interruptTaskOperation(aiAgentService, target.operationId);
    }

    await this.taskTopicModel.remove(target.taskId, topicId);
    await this.topicModel.delete(topicId);
  }

  /**
   * Delete a task: interrupt its still-running topics first, then remove the
   * row. Deleting without the interrupt leaves the run executing against a
   * task that no longer exists — its task tools answer "Task not found" and
   * every document it produces fails the `task_documents` foreign key.
   *
   * `keepOperationId` spares the caller's own run (an agent deleting the task
   * it is executing), which would otherwise interrupt itself mid-tool-call.
   */
  async deleteTask(
    idOrIdentifier: string,
    options: { keepOperationId?: string } = {},
  ): Promise<TaskItem> {
    const task = await this.resolveOrThrow(idOrIdentifier);

    const runningTopics = await this.taskTopicModel.findRunningByTaskIds([task.id]);

    // The runner marks the task `running` before it dispatches the agent and
    // records the topic / operation only after dispatch returns. A delete in
    // that window finds nothing to interrupt and would orphan the run it is
    // about to start. Past the grace window a missing operation means the
    // start died, and deletion goes ahead.
    const startedAt = task.startedAt ? new Date(task.startedAt).getTime() : 0;
    const isStarting =
      task.status === 'running' &&
      Date.now() - startedAt < TASK_RUN_STARTING_GRACE_MS &&
      (runningTopics.length === 0 || runningTopics.some((topic) => !topic.operationId));
    if (isStarting) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'This task is still starting its run. Try deleting it again in a moment.',
      });
    }

    const toInterrupt = runningTopics.filter(
      (topic) => topic.operationId && topic.operationId !== options.keepOperationId,
    );
    if (toInterrupt.length > 0) {
      const aiAgentService = new AiAgentService(this.db, this.userId, {
        workspaceId: this.workspaceId,
      });
      for (const topic of toInterrupt) {
        await this.interruptTaskOperation(aiAgentService, topic.operationId!);
      }
    }

    // Decide and delete under the task's row lock — the same lock a run takes
    // to record its topic. A run that recorded one after the checks above is
    // seen here and wins; a run that records later finds the task gone and
    // stops its own execution. Compare-and-delete on the status as well, so a
    // run that moved the task on in the meantime is never deleted under.
    //
    // The tool contract ("dependencies/topics/comments cascade-delete") is
    // honored here for topics themselves: `task_topics` rows go via FK
    // cascade, but the underlying `topics` rows have no FK back to `tasks`
    // and would otherwise survive as orphans that keep showing up in the
    // sidebar. Collect their ids before the task row goes (the cascade wipes
    // the links with it), then delete the topic rows in the same transaction.
    // The kept operation's own topic is excluded — it must survive with its
    // run (see the snapshot below).
    const handled = new Set(runningTopics.map((topic) => topic.operationId));
    const outcome = await this.db.transaction(async (tx) => {
      const taskModel = new TaskModel(tx, this.userId, this.workspaceId);
      if (!(await taskModel.lockForUpdate(task.id))) return 'gone' as const;
      const taskTopicModel = new TaskTopicModel(tx, this.userId, this.workspaceId);
      const nowRunning = await taskTopicModel.findRunningByTaskIds([task.id]);
      if (nowRunning.some((topic) => !handled.has(topic.operationId))) return 'conflict' as const;

      // The row lock guarantees no run can record a topic between here and
      // the status CAS below, so this snapshot is the complete topic set.
      // `keepOperationId` spares the caller's own run: its topic must survive
      // with the operation, or the messages ON DELETE CASCADE would pull the
      // conversation out from under the still-running tool call.
      const allTopics = await taskTopicModel.findByTaskId(task.id);
      const topicIds = allTopics
        .filter(
          (topic) =>
            !topic.topicId ||
            !options.keepOperationId ||
            topic.operationId !== options.keepOperationId,
        )
        .map((topic) => topic.topicId)
        .filter((topicId): topicId is string => !!topicId);

      if (!(await taskModel.deleteIfStatus(task.id, task.status))) return 'conflict' as const;

      if (topicIds.length > 0) {
        // trashScope variant: a linked topic already sitting in the recycle
        // bin must go too, or restoring it later resurrects the sidebar
        // orphan this cascade exists to eliminate.
        await new TopicModel(tx, this.userId, this.workspaceId).batchDeleteIncludingTrashed(
          topicIds,
        );
      }
      return 'deleted' as const;
    });
    if (outcome === 'conflict') {
      throw new TRPCError({
        code: 'CONFLICT',
        message:
          'The task changed while it was being deleted (it may have just started). Try again.',
      });
    }
    return task;
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
  async updateStatus(
    input: {
      error?: string;
      id: string;
      /**
       * The caller's own run, when an agent changes the task it is executing.
       * Completing that task is a delivery request: it is recorded and
       * finalized by onTopicComplete once the run ends, instead of
       * interrupting the run mid-tool-call.
       */
      operationId?: string;
      status: TaskStatus;
    },
    /**
     * Present only for a change a person or their agent made; its absence is
     * how system transitions (runner / lifecycle / watchdog) opt out of the
     * activity feed.
     */
    actor?: { agentId?: string | null; userId?: string | null },
  ): Promise<UpdateStatusResult> {
    const { id, operationId, status, error: errorMsg } = input;

    if (errorMsg && status !== 'failed') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Task error can only be provided when status is failed.',
      });
    }

    const resolved = await this.resolveOrThrow(id);
    assertArchivedTaskStaysIdle(resolved, { status });

    if (resolved.status === 'running' && status !== 'running') {
      const topics = await this.taskTopicModel.findByTaskId(resolved.id);

      if (
        status === 'completed' &&
        operationId &&
        topics.some((t) => t.status === 'running' && t.operationId === operationId)
      ) {
        await this.taskModel.updateContext(resolved.id, {
          completion: { requestedByOperationId: operationId },
        });
        return { completionDeferred: true, paused: [], task: resolved, unlocked: [] };
      }

      const aiAgentService = new AiAgentService(this.db, this.userId, {
        workspaceId: this.workspaceId,
      });

      for (const t of topics) {
        if (t.status !== 'running' || !t.topicId) continue;

        // Interrupt the remote operation first; if it fails, skip cancellation
        // to avoid desynchronizing DB state from a still-running operation.
        if (t.operationId) {
          try {
            await this.interruptTaskOperation(aiAgentService, t.operationId);
          } catch (err) {
            console.error(
              '[TaskService.updateStatus] failed to interrupt topic %s:',
              t.topicId,
              err,
            );
            throw err;
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

    const task = await writeKeepingArchivedIdle(this.db, (tx) => {
      const model = new TaskModel(tx, this.userId, this.workspaceId);
      return actor
        ? model.updateWithLog(resolved.id, { status, ...extra }, actor)
        : model.updateStatus(resolved.id, status, extra);
    });
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
        // The logged transition really happened and is now being undone, so
        // the undo is logged too (same actor, back to the same value): the
        // audit trail stays truthful and the feed folds the pair away.
        if (actor) await this.taskModel.updateWithLog(task.id, { status: resolved.status }, actor);
        else await this.taskModel.updateStatus(task.id, resolved.status);
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
  async updateStatusCascade(
    input: {
      id: string;
      status: 'canceled' | 'completed';
    },
    /** The person confirming "include subtasks"; absent for system callers. */
    actor?: { agentId?: string | null; userId?: string | null },
  ): Promise<UpdateStatusCascadeResult> {
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
            await this.interruptTaskOperation(aiAgentService, topic.operationId);
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
      // The pre-transaction snapshot only chose *which* tasks; what each one
      // is leaving is read under the lock, so a collaborator's edit between
      // the dialog and this write is logged as it really was.
      const locked = actor ? await taskModel.lockForStatusChange(targetIds) : [];
      updatedTasks = await taskModel.updateStatusForIds(targetIds, input.status, { completedAt });

      // A person confirmed this for the whole family, so every member that
      // moved gets its own row — one INSERT, not one per task.
      if (actor) {
        const { actorKind, ...actorColumns } = taskActivityActor(actor);
        await taskModel.addActivities(
          locked
            .filter((before) => before.status !== input.status)
            .map((before) => ({
              ...actorColumns,
              payload: { actorKind, from: before.status, to: input.status },
              taskId: before.id,
              type: 'status' as const,
              visibility: before.visibility,
            })),
        );
      }
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
    actor: { agentId?: string | null; userId?: string | null } = {},
    options: Parameters<TaskModel['updateWithLog']>[3] = {},
  ): Promise<TaskItem | null> {
    return this.withAssigneeUserLock(data.assigneeUserId, (db) =>
      writeKeepingArchivedIdle(db, (tx) =>
        new TaskModel(tx, this.userId, this.workspaceId).updateWithLog(
          taskId,
          data,
          actor,
          options,
        ),
      ),
    );
  }

  private async resolveOrThrow(idOrIdentifier: string): Promise<TaskItem> {
    const task = await this.taskModel.resolve(idOrIdentifier);
    if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
    return task;
  }

  async getTaskDetail(taskIdOrIdentifier: string): Promise<TaskDetailData | null> {
    return new TaskDetailService(this.db, this.userId, this.workspaceId).getTaskDetail(
      taskIdOrIdentifier,
    );
  }
}
