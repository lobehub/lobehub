import type {
  CheckpointConfig,
  NewTask,
  TaskActivityLogPayload,
  TaskActivityLogType,
  TaskItem,
  TaskVerifyConfig,
  WorkspaceData,
} from '@lobechat/types';
import { and, eq } from 'drizzle-orm';

import { merge } from '@/utils/merge';

import type {
  NewTaskActivity,
  NewTaskComment,
  TaskActivityItem,
  TaskCommentItem,
} from '../../schemas/task';
import { taskDependencies, tasks } from '../../schemas/task';
import type { LobeChatDatabase } from '../../type';
import { ProjectModel } from '../project';
import type { TaskListFilterOptions, TaskListOptions } from '../taskListFilters';
import * as activities from './activities';
import * as comments from './comments';
import * as config from './config';
import { getTaskVisibility, type TaskModelContext, taskOwnership } from './context';
import * as dependencies from './dependencies';
import * as documents from './documents';
import * as queries from './queries';
import * as rows from './rows';
import type { OrphanedRunningTopic } from './scheduling';
import * as scheduling from './scheduling';
import * as transfer from './transfer';
import * as tree from './tree';
import {
  DEFAULT_TASK_IDENTIFIER_PREFIX,
  normalizeTaskRefs,
  snapshotAutomation,
  taskActivityActor,
  TRACKED_TASK_COLUMNS,
  withStaleReposCleared,
} from './utils';

export type { OrphanedRunningTopic } from './scheduling';
export { isTaskIdentifierUniqueViolation, taskActivityActor } from './utils';

export class TaskModel {
  private readonly userId: string;
  private readonly db: LobeChatDatabase;
  private readonly workspaceId?: string;
  /** The scope handed to the helper modules in this directory. */
  private readonly ctx: TaskModelContext;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
    this.ctx = { db, userId, workspaceId };
  }

  // ========== CRUD ==========

  async create(
    data: Omit<NewTask, 'id' | 'identifier' | 'seq' | 'createdByUserId'>,
    options: { maxRetries?: number } = {},
  ): Promise<TaskItem> {
    const createData = normalizeTaskRefs(data);

    // Keep the invariant at the write boundary, including direct model callers.
    // Parent references here are canonical database ids; the service resolves
    // display identifiers before calling the model.
    if (createData.parentTaskId) {
      const parent = await this.findById(createData.parentTaskId);
      if (!parent) throw new Error('Task not found');
      if (createData.projectId && createData.projectId !== parent.projectId) {
        throw new Error('Subtask must belong to the same project as its parent');
      }
      createData.projectId ??= parent.projectId;
    }

    // A prefix is derived from placement, never accepted as a creation field.
    // Anyone who can see a project may file work in it; project settings stay
    // with its creator. A project without its own identifier keeps the scope's
    // default prefix.
    let identifierPrefix = DEFAULT_TASK_IDENTIFIER_PREFIX;
    if (createData.projectId) {
      const project = await new ProjectModel(this.db, this.userId, this.workspaceId).findById(
        createData.projectId,
      );
      if (!project) throw new Error('Project not found');
      identifierPrefix = project.identifier ?? DEFAULT_TASK_IDENTIFIER_PREFIX;
    }

    return rows.insertWithNextSeq(this.ctx, createData, identifierPrefix, options.maxRetries ?? 5);
  }

  async findById(id: string): Promise<TaskItem | null> {
    return rows.findById(this.ctx, id);
  }

  async findByIds(ids: string[]): Promise<TaskItem[]> {
    return rows.findByIds(this.ctx, ids);
  }

  async findAssigneesByIds(
    ids: string[],
  ): Promise<{ assigneeAgentId: string | null; id: string }[]> {
    return rows.findAssigneesByIds(this.ctx, ids);
  }

  async resolveMany(idsOrIdentifiers: string[]): Promise<TaskItem[]> {
    return rows.resolveMany(this.ctx, idsOrIdentifiers);
  }

  // Resolve id or identifier (e.g. 'T-1') to a task
  async resolve(idOrIdentifier: string): Promise<TaskItem | null> {
    if (idOrIdentifier.startsWith('task_')) return this.findById(idOrIdentifier);
    return this.findByIdentifier(idOrIdentifier.toUpperCase());
  }

  async findByIdentifier(identifier: string): Promise<TaskItem | null> {
    return rows.findByIdentifier(this.ctx, identifier);
  }

  async update(
    id: string,
    data: Partial<Omit<NewTask, 'id' | 'identifier' | 'seq' | 'createdByUserId'>>,
  ): Promise<TaskItem | null> {
    if (Object.keys(data).length === 0) return this.findById(id);

    // A reassignment is not a plain column write: the row being moved away from
    // decides whether the previous assignee's cloud-repo selection has to go,
    // so read it under a lock — a config write landing between the read and the
    // merge below would be lost. Every writer of the assignee column comes
    // through here (`updateWithLog`, the update procedure, the coordinator's
    // handoff/restart, the runner's inbox fallback), so this is the one place
    // the invariant has to hold; `updateWithLog` locks its own read for the
    // activity log and then delegates.
    if (data.assigneeAgentId === undefined) return rows.writeRow(this.ctx, this.db, id, data);

    return this.db.transaction(async (tx) => {
      const runner = tx as LobeChatDatabase;
      const [before] = await runner
        .select({ assigneeAgentId: tasks.assigneeAgentId, config: tasks.config })
        .from(tasks)
        .where(and(eq(tasks.id, id), taskOwnership(this.ctx)))
        .for('update')
        .limit(1);
      if (!before) return null;

      return rows.writeRow(this.ctx, runner, id, withStaleReposCleared(before, data));
    });
  }

  async delete(id: string): Promise<boolean> {
    return rows.deleteTask(this.ctx, id);
  }

  /**
   * Write `visibility` onto a task subtree and its task-owned child rows.
   * Task aggregate only — callers changing a task's visibility go through
   * `TaskSubtreeRepository.updateVisibility`, which also mirrors it onto
   * the task's Work row in the same transaction.
   */
  async setSubtreeVisibility(
    rootId: string,
    descendantIds: string[],
    visibility: 'private' | 'public',
  ): Promise<TaskItem | null> {
    return tree.setSubtreeVisibility(this.ctx, rootId, descendantIds, visibility);
  }

  async countTasksBlockingAgentDemotion(
    assigneeAgentId: string,
    agentOwnerUserId: string,
  ): Promise<number> {
    return rows.countTasksBlockingAgentDemotion(this.ctx, assigneeAgentId, agentOwnerUserId);
  }

  async subtreeHasOtherCreators(rootTaskId: string, creatorUserId: string): Promise<boolean> {
    return rows.subtreeHasOtherCreators(this.ctx, rootTaskId, creatorUserId);
  }

  async lockForUpdate(id: string): Promise<boolean> {
    return rows.lockForUpdate(this.ctx, id);
  }

  async deleteIfStatus(id: string, status: string): Promise<boolean> {
    return rows.deleteIfStatus(this.ctx, id, status);
  }

  async deleteAll(options?: { restrictToCreator?: boolean }): Promise<number> {
    return rows.deleteAll(this.ctx, options);
  }

  /**
   * Delete the given tasks (task aggregate only). Use
   * `TaskSubtreeRepository.deleteSubtree` to also drop their acceptances.
   */
  async deleteByIds(taskIds: string[]): Promise<number> {
    return tree.deleteTasksByIds(this.ctx, taskIds);
  }

  // ========== Query ==========

  async groupList(
    options: TaskListFilterOptions & {
      excludeStatuses?: string[];
      groupBy?: 'agent' | 'assignee' | 'member' | 'priority';
      groups?: Array<{
        key: string;
        limit?: number;
        offset?: number;
        statuses: string[];
      }>;
    },
  ): Promise<
    Array<{
      assigneeAgentId?: string | null;
      assigneeUserId?: string | null;
      hasMore: boolean;
      key: string;
      limit: number;
      offset: number;
      priority?: number;
      tasks: TaskItem[];
      total: number;
    }>
  > {
    return queries.groupList(this.ctx, options);
  }

  async list(options: TaskListOptions = {}): Promise<{ tasks: TaskItem[]; total: number }> {
    return queries.list(this.ctx, options);
  }

  async reorder(order: Array<{ id: string; sortOrder: number }>): Promise<void> {
    return rows.reorder(this.ctx, order);
  }

  async findSubtasks(parentTaskId: string): Promise<TaskItem[]> {
    return tree.findSubtasks(this.ctx, parentTaskId);
  }

  async findAllDescendants(rootTaskId: string): Promise<TaskItem[]> {
    return tree.findAllDescendants(this.ctx, rootTaskId);
  }

  async getTaskTree(rootTaskId: string): Promise<TaskItem[]> {
    return tree.getTaskTree(this.ctx, rootTaskId);
  }

  async getTreeAgentIdsForTaskIds(taskIds: string[]): Promise<Record<string, string[]>> {
    return tree.getTreeAgentIdsForTaskIds(this.ctx, taskIds);
  }

  // ========== Status ==========

  async updateStatus(
    id: string,
    status: string,
    extra?: { completedAt?: Date; error?: string | null; startedAt?: Date },
  ): Promise<TaskItem | null> {
    return this.update(id, { status, ...extra });
  }

  async updateStatusIfCurrent(
    id: string,
    currentStatus: string,
    status: string,
    extra?: { completedAt?: Date | null; error?: string | null; startedAt?: Date },
  ): Promise<TaskItem | null> {
    return rows.updateStatusIfCurrent(this.ctx, id, currentStatus, status, extra);
  }

  async completeIfCompletionRequested(id: string, operationId: string): Promise<TaskItem | null> {
    return rows.completeIfCompletionRequested(this.ctx, id, operationId);
  }

  async withdrawCompletionRequest(id: string, operationId: string): Promise<boolean> {
    return rows.withdrawCompletionRequest(this.ctx, id, operationId);
  }

  async batchUpdateStatus(ids: string[], status: string): Promise<number> {
    return rows.batchUpdateStatus(this.ctx, ids, status);
  }

  async updateStatusForIds(
    ids: string[],
    status: string,
    extra?: { completedAt?: Date; error?: string | null; startedAt?: Date },
  ): Promise<TaskItem[]> {
    return rows.updateStatusForIds(this.ctx, ids, status, extra);
  }

  // ========== Config ==========

  /**
   * Safely merge-update the task's config object.
   * Reads the current config, deep-merges the incoming partial, and writes back.
   *
   * The read is taken under a row lock: several independent writers merge into
   * this one column (model, run location, checkpoint, review, verify), and two
   * of them reading the same snapshot would let the later whole-column write
   * silently drop the other's key.
   */
  async updateTaskConfig(id: string, partial: Record<string, unknown>): Promise<TaskItem | null> {
    return config.rewriteConfig(this.ctx, id, (current) => merge(current, partial));
  }

  // ========== Context (runtime state) ==========

  /**
   * Deep-merge into the task's context JSONB. Used by the heartbeat scheduler
   * to update `context.scheduler.{tickMessageId, consecutiveFailures, ...}`
   * without disturbing other namespaces under context.
   */
  async updateContext(id: string, partial: Record<string, unknown>): Promise<TaskItem | null> {
    const task = await this.findById(id);
    if (!task) return null;

    const current = (task.context as Record<string, unknown>) || {};
    const context = merge(current, partial);
    return this.update(id, { context });
  }

  // ========== Checkpoint ==========

  getCheckpointConfig(task: TaskItem): CheckpointConfig {
    return config.getCheckpointConfig(task);
  }

  async updateCheckpointConfig(id: string, checkpoint: CheckpointConfig): Promise<TaskItem | null> {
    return this.updateTaskConfig(id, { checkpoint });
  }

  // ========== Review Config ==========

  getReviewConfig(task: TaskItem): Record<string, any> | undefined {
    return config.getReviewConfig(task);
  }

  async updateReviewConfig(id: string, review: Record<string, any>): Promise<TaskItem | null> {
    return this.updateTaskConfig(id, { review });
  }

  // ========== Verify Config ==========

  getVerifyConfig(task: TaskItem): TaskVerifyConfig | undefined {
    return config.getVerifyConfig(task);
  }

  /**
   * Resolve the effective verify config for a task, honoring subtask
   * inheritance. Whole-config override semantics: the task uses its own config
   * when it has one, otherwise it walks up `parentTaskId` and adopts the
   * nearest ancestor's config in full (never a field-level merge of the two).
   * Returns `undefined` when no task in the chain has a verify config.
   */
  async resolveVerifyConfig(taskId: string): Promise<TaskVerifyConfig | undefined> {
    const seen = new Set<string>();
    let currentId: string | null = taskId;

    while (currentId && !seen.has(currentId)) {
      seen.add(currentId);
      const task = await this.findById(currentId);
      if (!task) break;

      const config = this.getVerifyConfig(task);
      if (config) return config;

      currentId = task.parentTaskId;
    }
    return undefined;
  }

  async updateVerifyConfig(
    id: string,
    patch: { [K in keyof TaskVerifyConfig]?: TaskVerifyConfig[K] | null },
  ): Promise<TaskItem | null> {
    return config.updateVerifyConfig(this.ctx, id, patch);
  }

  // Check if a task should pause after a topic completes
  // Default: pause (when no checkpoint config is set)
  // Explicit: pause only if topic.after is true
  shouldPauseOnTopicComplete(task: TaskItem): boolean {
    const checkpoint = this.getCheckpointConfig(task);
    const hasAnyConfig = Object.keys(checkpoint).length > 0;
    return hasAnyConfig ? !!checkpoint.topic?.after : true;
  }

  // Check if a task should be paused before starting (parent's tasks.beforeIds)
  shouldPauseBeforeStart(parentTask: TaskItem, childIdentifier: string): boolean {
    const checkpoint = this.getCheckpointConfig(parentTask);
    return checkpoint.tasks?.beforeIds?.includes(childIdentifier) ?? false;
  }

  // Check if a task should be paused after completing (parent's tasks.afterIds)
  shouldPauseAfterComplete(parentTask: TaskItem, childIdentifier: string): boolean {
    const checkpoint = this.getCheckpointConfig(parentTask);
    return checkpoint.tasks?.afterIds?.includes(childIdentifier) ?? false;
  }

  // ========== Heartbeat ==========

  async updateHeartbeat(id: string): Promise<void> {
    return rows.updateHeartbeat(this.ctx, id);
  }

  static async getScheduledTasks(db: LobeChatDatabase): Promise<TaskItem[]> {
    return scheduling.getScheduledTasks(db);
  }

  static async swapDispatchedScheduleOccurrence(
    db: LobeChatDatabase,
    taskId: string,
    expected: string | null,
    next: string | null,
  ): Promise<boolean> {
    return scheduling.swapDispatchedScheduleOccurrence(db, taskId, expected, next);
  }

  static async findStuckTasks(db: LobeChatDatabase): Promise<TaskItem[]> {
    return scheduling.findStuckTasks(db);
  }

  static async findOrphanedRunningTopics(
    db: LobeChatDatabase,
    options: { limit?: number; staleBefore: Date },
  ): Promise<OrphanedRunningTopic[]> {
    return scheduling.findOrphanedRunningTopics(db, options);
  }

  // ========== Dependencies ==========

  async addDependency(taskId: string, dependsOnId: string, type: string = 'blocks'): Promise<void> {
    const dependencyTasks = await this.findByIds([taskId, dependsOnId]);
    const task = dependencyTasks.find(({ id }) => id === taskId);
    const dependsOn = dependencyTasks.find(({ id }) => id === dependsOnId);
    if (!task || !dependsOn) throw new Error('Task not found');
    if (task.projectId !== dependsOn.projectId && (task.projectId || dependsOn.projectId)) {
      throw new Error('Task dependencies cannot cross project boundaries');
    }

    const visibility = await getTaskVisibility(this.ctx, taskId);
    await this.db
      .insert(taskDependencies)
      .values({
        dependsOnId,
        taskId,
        type,
        userId: this.userId,
        visibility,
        workspaceId: this.workspaceId ?? null,
      })
      .onConflictDoNothing();
  }

  async removeDependency(taskId: string, dependsOnId: string): Promise<void> {
    return dependencies.removeDependency(this.ctx, taskId, dependsOnId);
  }

  async getDependencies(taskId: string) {
    return dependencies.getDependencies(this.ctx, taskId);
  }

  async getDependenciesByTaskIds(taskIds: string[]) {
    return dependencies.getDependenciesByTaskIds(this.ctx, taskIds);
  }

  async getDependents(taskId: string) {
    return dependencies.getDependents(this.ctx, taskId);
  }

  async areAllDependenciesCompleted(taskId: string): Promise<boolean> {
    return dependencies.areAllDependenciesCompleted(this.ctx, taskId);
  }

  // Find tasks that are now unblocked after a dependency completes
  async getUnlockedTasks(completedTaskId: string): Promise<TaskItem[]> {
    return this.getUnlockedTasksForMany([completedTaskId]);
  }

  async getUnlockedTasksForMany(completedTaskIds: string[]): Promise<TaskItem[]> {
    return dependencies.getUnlockedTasksForMany(this.ctx, completedTaskIds);
  }

  async areAllSubtasksCompleted(parentTaskId: string): Promise<boolean> {
    return dependencies.areAllSubtasksCompleted(this.ctx, parentTaskId);
  }

  // ========== Documents (MVP Workspace) ==========

  async pinDocument(taskId: string, documentId: string, pinnedBy: string = 'agent'): Promise<void> {
    return documents.pinDocument(this.ctx, taskId, documentId, pinnedBy);
  }

  async unpinDocument(taskId: string, documentId: string): Promise<void> {
    return documents.unpinDocument(this.ctx, taskId, documentId);
  }

  async getPinnedDocuments(taskId: string) {
    return documents.getPinnedDocuments(this.ctx, taskId);
  }

  async getDocumentsPinnedSince(
    taskId: string,
    since: Date,
  ): Promise<{ id: string; kind: string | null; title: string | null }[]> {
    return documents.getDocumentsPinnedSince(this.ctx, taskId, since);
  }

  async getTreePinnedDocuments(rootTaskId: string): Promise<WorkspaceData> {
    return documents.getTreePinnedDocuments(this.ctx, rootTaskId);
  }

  // ========== Topic Management ==========

  async incrementTopicCount(id: string): Promise<void> {
    return rows.incrementTopicCount(this.ctx, id);
  }

  async updateCurrentTopic(id: string, topicId: string): Promise<void> {
    return rows.updateCurrentTopic(this.ctx, id, topicId);
  }

  // ========== Comments ==========

  async addComment(data: Omit<NewTaskComment, 'id'>): Promise<TaskCommentItem> {
    return comments.addComment(this.ctx, data);
  }

  async findCommentById(id: string): Promise<TaskCommentItem | undefined> {
    return comments.findCommentById(this.ctx, id);
  }

  async getComments(taskId: string): Promise<TaskCommentItem[]> {
    return comments.getComments(this.ctx, taskId);
  }

  async deleteComment(id: string): Promise<boolean> {
    return comments.deleteComment(this.ctx, id);
  }

  async updateComment(
    id: string,
    content: string,
    opts?: { editorData?: unknown },
  ): Promise<TaskCommentItem | undefined> {
    return comments.updateComment(this.ctx, id, content, opts);
  }

  // ========== Activities ==========

  async addActivity(
    data: Omit<NewTaskActivity, 'id' | 'userId' | 'workspaceId' | 'visibility'>,
  ): Promise<TaskActivityItem> {
    return activities.addActivity(this.ctx, data);
  }

  async addActivities(
    rows: Omit<NewTaskActivity, 'id' | 'userId' | 'workspaceId'>[],
  ): Promise<TaskActivityItem[]> {
    return activities.addActivities(this.ctx, rows);
  }

  async lockForStatusChange(
    ids: string[],
  ): Promise<{ id: string; status: string; visibility: 'private' | 'public' }[]> {
    return activities.lockForStatusChange(this.ctx, ids);
  }

  /**
   * Update a task and append one event per tracked field that actually
   * changed, in ONE transaction, with the previous values taken from a
   * **locked** read of the row.
   *
   * The lock is the point. Reading the "before" value outside the write lets
   * two concurrent edits both observe the same origin — an A→B and an A→C
   * racing on one task persist A→B then B→C while a lock-free recorder logs
   * A→B and A→C, losing the middle state. Rows are inserted next to the write
   * they describe, so their order cannot disagree with the order the updates
   * landed in.
   *
   * Which edits reach the feed is decided by the caller, not here: anything
   * that goes through this method is logged. Person-made changes (the update
   * procedure, the agent `editTask` tool, the status picker) and the runner's
   * inbox fallback come here; the runner / lifecycle / watchdog status
   * transitions use the plain writers, because the run row already tells that
   * story.
   */
  async updateWithLog(
    id: string,
    data: Partial<Omit<NewTask, 'id' | 'identifier' | 'seq' | 'createdByUserId'>>,
    actor: { agentId?: string | null; userId?: string | null },
    options: {
      /**
       * Deep-merged into the `config` column under this update's row lock,
       * instead of replacing it. A client that edits one key (the schedule
       * cap) must not send back a whole-config snapshot that can predate
       * another tab's or member's write of a different key.
       */
      configPatch?: Record<string, unknown>;
    } = {},
  ): Promise<TaskItem | null> {
    const { configPatch } = options;
    const touched = !!configPatch || TRACKED_TASK_COLUMNS.some((col) => data[col] !== undefined);
    // Nothing to diff against: an ordinary rename should not pay for a lock.
    if (!touched) return this.update(id, data);

    return this.db.transaction(async (tx) => {
      const runner = tx as LobeChatDatabase;
      const [before] = await runner
        .select({
          assigneeAgentId: tasks.assigneeAgentId,
          assigneeUserId: tasks.assigneeUserId,
          automationMode: tasks.automationMode,
          config: tasks.config,
          heartbeatInterval: tasks.heartbeatInterval,
          priority: tasks.priority,
          schedulePattern: tasks.schedulePattern,
          scheduleTimezone: tasks.scheduleTimezone,
          status: tasks.status,
        })
        .from(tasks)
        .where(and(eq(tasks.id, id), taskOwnership(this.ctx)))
        .for('update')
        .limit(1);
      if (!before) return null;

      const scoped = new TaskModel(runner, this.userId, this.workspaceId);

      // The reassignment rule — dropping the previous assignee's cloud-repo
      // selection — lives in `update`, which is the only writer of the assignee
      // column, so this locked read is kept for the activity-log diff only and
      // the write below re-checks the rule in the same transaction.
      const writeData = configPatch
        ? {
            ...data,
            config: merge(
              ((data.config ?? before.config) as Record<string, unknown> | null) ?? {},
              configPatch,
            ),
          }
        : data;
      const updated = await scoped.update(id, writeData);
      if (!updated) return null;

      const events: { payload: TaskActivityLogPayload; type: TaskActivityLogType }[] = [];

      // The two assignee slots are independent — one edit can move both, and
      // each gets its own row so the feed reads one change per line.
      if (before.assigneeAgentId !== updated.assigneeAgentId) {
        events.push({
          payload: { fromId: before.assigneeAgentId, toId: updated.assigneeAgentId },
          type: 'assignee_agent',
        });
      }
      if (before.assigneeUserId !== updated.assigneeUserId) {
        events.push({
          payload: { fromId: before.assigneeUserId, toId: updated.assigneeUserId },
          type: 'assignee_user',
        });
      }
      if (before.status !== updated.status) {
        events.push({ payload: { from: before.status, to: updated.status }, type: 'status' });
      }
      if ((before.priority ?? null) !== (updated.priority ?? null)) {
        events.push({
          payload: { from: before.priority ?? null, to: updated.priority ?? null },
          type: 'priority',
        });
      }
      const automationBefore = snapshotAutomation(before);
      const automationAfter = snapshotAutomation(updated);
      if (JSON.stringify(automationBefore) !== JSON.stringify(automationAfter)) {
        events.push({
          payload: { from: automationBefore, to: automationAfter },
          type: 'automation',
        });
      }

      const { actorKind, ...actorColumns } = taskActivityActor(actor);
      for (const event of events) {
        await scoped.addActivity({
          ...actorColumns,
          payload: { ...event.payload, actorKind },
          taskId: id,
          type: event.type,
        });
      }

      return updated;
    });
  }

  async getActivities(taskId: string, limit?: number): Promise<TaskActivityItem[]> {
    return activities.getActivities(this.ctx, taskId, limit);
  }

  // ========== Transfer / Copy ==========

  /**
   * Transfer a task subtree to another workspace / personal scope. Reallocates
   * `identifier`/`seq` in the target scope and rewrites the child tables that
   * mirror the parent's ownership (`task_dependencies`, `task_documents`,
   * `task_comments`, `task_activities`) so the ownership predicates keep
   * resolving after the move — those mirrored columns are what authorizes
   * reads, so a child left behind goes invisible in the destination scope.
   *
   * NOTE: `task_topics` and `briefs` carry the same mirrored columns but are
   * not rewritten here. Pre-existing gap, called out rather than widened.
   *
   * Cross-scope references that may no longer be valid are cleared:
   *   - `assigneeAgentId` (workspace move: agent likely doesn't exist there)
   *   - `currentTopicId` (topic ownership is also moving but the link is
   *     reset to avoid surfacing a stale active topic in the new scope)
   */
  /**
   * Whether the task subtree contains rows created by someone else. Transfers
   * rehome every cascaded row, so non-owner members must not move a task tree
   * that carries teammates' subtasks.
   */
  async subtreeHasForeignRows(taskId: string): Promise<boolean> {
    const subtree = await tree.collectTaskSubtree(this.ctx, taskId, this.db);
    return subtree.some((task) => task.createdByUserId !== this.userId);
  }

  async transferTo(
    taskId: string,
    targetWorkspaceId: string | null,
    targetUserId: string,
    targetVisibility?: 'private' | 'public',
  ): Promise<{ taskIds: string[] }> {
    return transfer.transferTo(this.ctx, taskId, targetWorkspaceId, targetUserId, targetVisibility);
  }

  async copyToWorkspace(
    taskId: string,
    targetWorkspaceId: string | null,
    targetUserId: string,
    targetVisibility?: 'private' | 'public',
  ): Promise<{ rootId: string }> {
    return transfer.copyToWorkspace(
      this.ctx,
      taskId,
      targetWorkspaceId,
      targetUserId,
      targetVisibility,
    );
  }
}
