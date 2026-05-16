import type {
  TaskDetailActivity,
  TaskDetailActivityAuthor,
  TaskDetailData,
  TaskDetailSubtask,
  TaskDetailWorkspaceNode,
  TaskItem,
  TaskStatus,
  TaskTopicHandoff,
  WorkspaceData,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';

import { AgentModel } from '@/database/models/agent';
import { BriefModel } from '@/database/models/brief';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';

import { AiAgentService } from '../aiAgent';
import { BriefService } from '../brief';
import { type SubtaskGraphPlan, TaskGraphService } from '../taskGraph';
import { type ReviewResult, TaskReviewService } from '../taskReview';
import { TaskRunnerService } from '../taskRunner';

const emptyWorkspace: WorkspaceData = { nodeMap: {}, tree: [] };
const UNTITLED_TOPIC_TITLE = 'Untitled';

export interface CreateTaskInput {
  assigneeAgentId?: string;
  assigneeUserId?: string;
  automationMode?: 'heartbeat' | 'schedule';
  createdByAgentId?: string;
  description?: string;
  identifierPrefix?: string;
  instruction: string;
  name?: string;
  parentTaskId?: string;
  priority?: number;
  schedulePattern?: string;
  scheduleTimezone?: string;
  sortOrder?: number;
}

export interface UpdateStatusResult {
  allSubtasksDone?: boolean;
  checkpointTriggered?: boolean;
  parentTaskId?: string | null;
  paused: string[];
  task: TaskItem;
  unlocked: string[];
}

export interface RunReadySubtasksResult {
  failed: { error: string; identifier: string }[];
  kickedOff: string[];
  plan: SubtaskGraphPlan;
  skipped?: { reason: 'nothing-runnable' };
}

export class TaskService {
  private agentModel: AgentModel;
  private briefModel: BriefModel;
  private briefService: BriefService;
  private db: LobeChatDatabase;
  private taskModel: TaskModel;
  private taskTopicModel: TaskTopicModel;
  private topicModel: TopicModel;
  private userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
    this.agentModel = new AgentModel(db, userId);
    this.taskModel = new TaskModel(db, userId);
    this.taskTopicModel = new TaskTopicModel(db, userId);
    this.topicModel = new TopicModel(db, userId);
    this.briefModel = new BriefModel(db, userId);
    this.briefService = new BriefService(db, userId);
  }

  /**
   * Create a task. Validates the assignee belongs to the user, resolves
   * `parentTaskId` if it's an identifier, and snapshots the assignee agent's
   * current model/provider into `task.config` so later changes to the agent's
   * default model don't silently affect this task.
   */
  async createTask(input: CreateTaskInput): Promise<TaskItem> {
    await this.assertAssigneeAgentBelongsToUser(input.assigneeAgentId);

    const createData: CreateTaskInput & { config?: Record<string, unknown> } = { ...input };

    if (createData.parentTaskId) {
      const parent = await this.resolveOrThrow(createData.parentTaskId);
      createData.parentTaskId = parent.id;
    }

    if (input.assigneeAgentId) {
      const snapshot = await this.agentModel.getAgentModelConfig(input.assigneeAgentId);
      if (snapshot) createData.config = snapshot;
    }

    return this.taskModel.create(createData);
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
      const aiAgentService = new AiAgentService(this.db, this.userId);
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
      const aiAgentService = new AiAgentService(this.db, this.userId);
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

    const reviewService = new TaskReviewService(this.db, this.userId);
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
      const aiAgentService = new AiAgentService(this.db, this.userId);

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
      const runner = new TaskRunnerService(this.db, this.userId);
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
   * Compute the subtask execution plan for `idOrIdentifier` without
   * actually kicking anything off.
   */
  async previewSubtaskLayers(idOrIdentifier: string): Promise<SubtaskGraphPlan> {
    const parent = await this.resolveOrThrow(idOrIdentifier);
    const graph = new TaskGraphService(this.db, this.userId);
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
    const graph = new TaskGraphService(this.db, this.userId);
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
    const runner = new TaskRunnerService(this.db, this.userId);

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
    const exists = await this.agentModel.existsById(assigneeAgentId);
    if (!exists) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Assignee agent not found' });
    }
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

    const [allDescendants, dependencies, topics, briefs, comments, workspace] = await Promise.all([
      this.taskModel.findAllDescendants(task.id),
      this.taskModel.getDependencies(task.id),
      this.taskTopicModel.findWithHandoff(task.id, 100).catch(() => []),
      this.briefModel.findByTaskId(task.id).catch(() => []),
      this.taskModel.getComments(task.id).catch(() => []),
      this.taskModel.getTreePinnedDocuments(task.id).catch(() => emptyWorkspace),
    ]);

    // Build dependency map for all descendants
    const allDescendantIds = allDescendants.map((s) => s.id);
    const allDescendantDeps =
      allDescendantIds.length > 0
        ? await this.taskModel.getDependenciesByTaskIds(allDescendantIds).catch(() => [])
        : [];
    const idToIdentifier = new Map(allDescendants.map((s) => [s.id, s.identifier]));
    const depMap = new Map<string, string>();
    for (const dep of allDescendantDeps) {
      const depId = idToIdentifier.get(dep.dependsOnId);
      if (depId) depMap.set(dep.taskId, depId);
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
          automationMode: s.automationMode,
          blockedBy: depMap.get(s.id),
          children: buildSubtaskTree(s.id),
          ...(s.heartbeatInterval != null ? { heartbeat: { interval: s.heartbeatInterval } } : {}),
          identifier: s.identifier,
          name: s.name,
          priority: s.priority,
          ...(s.schedulePattern || s.scheduleTimezone
            ? { schedule: { pattern: s.schedulePattern, timezone: s.scheduleTimezone } }
            : {}),
          status: s.status,
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
    let parent: { identifier: string; name: string | null } | null = null;
    if (task.parentTaskId) {
      const parentTask = await this.taskModel.findById(task.parentTaskId);
      if (parentTask) {
        parent = { identifier: parentTask.identifier, name: parentTask.name };
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

    // Topics are created by the task's assignee agent
    if (task.assigneeAgentId && topics.length > 0) agentIds.add(task.assigneeAgentId);
    // Briefs may have an agentId
    for (const b of briefs) {
      if (b.agentId) agentIds.add(b.agentId);
    }
    // Comments have authorAgentId or authorUserId
    for (const c of comments) {
      if (c.authorAgentId) agentIds.add(c.authorAgentId);
      if (c.authorUserId) userIds.add(c.authorUserId);
    }
    // Creator of the task itself (agent takes precedence over user)
    if (task.createdByAgentId) agentIds.add(task.createdByAgentId);
    else if (task.createdByUserId) userIds.add(task.createdByUserId);

    const [authorMap, enrichedBriefs] = await Promise.all([
      this.resolveAuthors(agentIds, userIds),
      this.briefService
        .enrichBriefAgentOnly(briefs)
        .catch(() => briefs.map((b) => ({ ...b, agent: null }))),
    ]);

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
        return {
          author: task.assigneeAgentId ? authorMap.get(task.assigneeAgentId) : undefined,
          completedAt: toISO(t.completedAt),
          id: t.topicId ?? undefined,
          operationId: t.operationId ?? null,
          runningOperation: t.metadata?.runningOperation ?? null,
          seq: t.seq,
          status: t.status,
          summary: handoff?.summary,
          time: toISO(t.createdAt),
          title: handoff?.title || t.title || UNTITLED_TOPIC_TITLE,
          type: 'topic' as const,
        };
      }),
      ...enrichedBriefs.map((b) => ({
        actions: b.actions ?? undefined,
        agent: b.agent,
        agentId: b.agentId,
        artifacts: b.artifacts ?? undefined,
        author: b.agentId ? authorMap.get(b.agentId) : undefined,
        briefType: b.type,
        createdAt: toISO(b.createdAt),
        cronJobId: b.cronJobId,
        id: b.id,
        priority: b.priority,
        readAt: toISO(b.readAt),
        resolvedAction: b.resolvedAction,
        resolvedAt: toISO(b.resolvedAt),
        resolvedComment: b.resolvedComment,
        summary: b.summary,
        taskId: b.taskId,
        time: toISO(b.createdAt),
        title: b.title,
        topicId: b.topicId,
        type: 'brief' as const,
        userId: b.userId,
      })),
      ...comments.map((c) => ({
        agentId: c.authorAgentId,
        author: c.authorAgentId
          ? authorMap.get(c.authorAgentId)
          : c.authorUserId
            ? authorMap.get(c.authorUserId)
            : undefined,
        content: c.content,
        id: c.id,
        time: toISO(c.createdAt),
        type: 'comment' as const,
      })),
    ].sort((a, b) => {
      if (!a.time) return 1;
      if (!b.time) return -1;
      return a.time.localeCompare(b.time);
    });

    const taskConfig = task.config ? (task.config as Record<string, unknown>) : undefined;
    const scheduleConfig = (taskConfig?.schedule ?? {}) as { maxExecutions?: number | null };

    return {
      agentId: task.assigneeAgentId,
      automationMode: task.automationMode ?? null,
      checkpoint: this.taskModel.getCheckpointConfig(task),
      config: taskConfig,
      createdAt: task.createdAt ? new Date(task.createdAt).toISOString() : undefined,
      dependencies: dependencies.map((d) => {
        const info = depIdToInfo.get(d.dependsOnId);
        return {
          dependsOn: info?.identifier ?? d.dependsOnId,
          name: info?.name,
          type: d.type,
        };
      }),
      description: task.description,
      error: task.error,
      heartbeat:
        task.heartbeatInterval || task.heartbeatTimeout || task.lastHeartbeatAt
          ? {
              interval: task.heartbeatInterval,
              lastAt: task.lastHeartbeatAt ? new Date(task.lastHeartbeatAt).toISOString() : null,
              timeout: task.heartbeatTimeout,
            }
          : undefined,
      identifier: task.identifier,
      instruction: task.instruction,
      name: task.name,
      parent,
      priority: task.priority,
      review: this.taskModel.getReviewConfig(task),
      schedule:
        task.schedulePattern || task.scheduleTimezone || scheduleConfig.maxExecutions != null
          ? {
              maxExecutions: scheduleConfig.maxExecutions ?? null,
              pattern: task.schedulePattern,
              timezone: task.scheduleTimezone,
            }
          : undefined,
      status: task.status,
      userId: task.assigneeUserId,
      subtasks,
      activities: activities.length > 0 ? activities : undefined,
      topicCount: topics.length > 0 ? topics.length : undefined,
      workspace: workspaceFolders.length > 0 ? workspaceFolders : undefined,
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
