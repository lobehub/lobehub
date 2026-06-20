import type {
  CheckpointConfig,
  NewTask,
  TaskItem,
  TaskVerifyConfig,
  WorkspaceData,
  WorkspaceDocNode,
  WorkspaceTreeNode,
} from '@lobechat/types';
import { and, desc, eq, gte, inArray, isNotNull, isNull, ne, notInArray, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { merge } from '@/utils/merge';

import { documents } from '../schemas/file';
import type { NewTaskComment, TaskCommentItem } from '../schemas/task';
import { taskComments, taskDependencies, taskDocuments, tasks } from '../schemas/task';
import type { LobeChatDatabase } from '../type';
import { buildWorkspaceWhere } from '../utils/workspace';

export class TaskModel {
  private readonly userId: string;
  private readonly db: LobeChatDatabase;
  private readonly workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  /**
   * Compat-mode ownership predicate for the `tasks` table.
   * `tasks` uses `createdByUserId` instead of `userId`.
   */
  private ownership = () =>
    buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      { userId: tasks.createdByUserId, workspaceId: tasks.workspaceId },
    );

  /**
   * Ownership predicate for task child tables (deps / docs / comments) that
   * use a `userId` column instead of `createdByUserId`.
   */
  private childOwnership = (cols: { userId: AnyPgColumn; workspaceId: AnyPgColumn }) =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, cols);

  /**
   * Raw-SQL ownership clause for use inside `db.execute(sql...)` CTEs that
   * can't easily compose with drizzle's `and(...)` helpers. Mirrors
   * `buildWorkspaceWhere` semantics:
   *   - workspace mode → `workspace_id = $ws`
   *   - personal mode  → `created_by_user_id = $userId AND workspace_id IS NULL`
   */
  private ownershipSql = (alias?: string) => {
    const prefix = alias ? sql.raw(`${alias}.`) : sql.raw('');
    return this.workspaceId
      ? sql`${prefix}workspace_id = ${this.workspaceId}`
      : sql`${prefix}created_by_user_id = ${this.userId} AND ${prefix}workspace_id IS NULL`;
  };

  // ========== CRUD ==========

  async create(
    data: Omit<NewTask, 'id' | 'identifier' | 'seq' | 'createdByUserId'> & {
      identifierPrefix?: string;
    },
  ): Promise<TaskItem> {
    const { identifierPrefix = 'T', ...rest } = data;

    // Retry loop to handle concurrent creates (parallel tool calls)
    const maxRetries = 5;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Seq is allocated per ownership scope: workspace-wide in team mode,
        // user-private in personal mode. This keeps `T-N` identifiers stable
        // within the surface the user actually sees.
        const seqResult = await this.db
          .select({ maxSeq: sql<number>`COALESCE(MAX(${tasks.seq}), 0)` })
          .from(tasks)
          .where(this.ownership());

        const nextSeq = Number(seqResult[0].maxSeq) + 1;
        const identifier = `${identifierPrefix}-${nextSeq}`;

        const [task] = await this.db
          .insert(tasks)
          .values({
            ...rest,
            createdByUserId: this.userId,
            identifier,
            seq: nextSeq,
            workspaceId: this.workspaceId ?? null,
          } as NewTask)
          .returning();

        return task;
      } catch (error: any) {
        // Retry on unique constraint violation (concurrent seq conflict)
        // Check error itself, cause, and stringified message for PG error code 23505
        const errStr =
          String(error?.message || '') +
          String(error?.cause?.code || '') +
          String(error?.code || '');
        const isUniqueViolation =
          errStr.includes('23505') || errStr.includes('unique') || errStr.includes('duplicate');
        if (isUniqueViolation && attempt < maxRetries - 1) {
          continue;
        }
        throw error;
      }
    }

    throw new Error('Failed to create task after max retries');
  }

  async findById(id: string): Promise<TaskItem | null> {
    const result = await this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), this.ownership()))
      .limit(1);

    return result[0] || null;
  }

  async findByIds(ids: string[]): Promise<TaskItem[]> {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(tasks)
      .where(and(inArray(tasks.id, ids), this.ownership()));
  }

  // Resolve id or identifier (e.g. 'T-1') to a task
  async resolve(idOrIdentifier: string): Promise<TaskItem | null> {
    if (idOrIdentifier.startsWith('task_')) return this.findById(idOrIdentifier);
    return this.findByIdentifier(idOrIdentifier.toUpperCase());
  }

  async findByIdentifier(identifier: string): Promise<TaskItem | null> {
    const result = await this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.identifier, identifier), this.ownership()))
      .limit(1);

    return result[0] || null;
  }

  async update(
    id: string,
    data: Partial<Omit<NewTask, 'id' | 'identifier' | 'seq' | 'createdByUserId'>>,
  ): Promise<TaskItem | null> {
    if (Object.keys(data).length === 0) return this.findById(id);

    const updated = await this.db
      .update(tasks)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(tasks.id, id), this.ownership()))
      .returning();
    return updated[0] || null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db
      .delete(tasks)
      .where(and(eq(tasks.id, id), this.ownership()))
      .returning();

    return result.length > 0;
  }

  async deleteAll(): Promise<number> {
    const result = await this.db.delete(tasks).where(this.ownership()).returning();

    return result.length;
  }

  // ========== Query ==========

  async groupList(options: {
    assigneeAgentId?: string;
    groups: Array<{
      key: string;
      limit?: number;
      offset?: number;
      statuses: string[];
    }>;
    parentTaskId?: string | null;
  }): Promise<
    Array<{
      hasMore: boolean;
      key: string;
      limit: number;
      offset: number;
      tasks: TaskItem[];
      total: number;
    }>
  > {
    const { groups, assigneeAgentId, parentTaskId } = options;

    const baseConditions = [this.ownership()];
    if (assigneeAgentId) baseConditions.push(eq(tasks.assigneeAgentId, assigneeAgentId));
    if (parentTaskId === null) {
      baseConditions.push(isNull(tasks.parentTaskId));
    } else if (parentTaskId) {
      baseConditions.push(eq(tasks.parentTaskId, parentTaskId));
    }

    // Collect all statuses for a single aggregated count query
    const allStatuses = Array.from(new Set(groups.flatMap((g) => g.statuses)));
    const countResult = await this.db
      .select({ count: sql<number>`count(*)`, status: tasks.status })
      .from(tasks)
      .where(and(...baseConditions, inArray(tasks.status, allStatuses)))
      .groupBy(tasks.status);

    const countByStatus: Record<string, number> = {};
    for (const row of countResult) {
      countByStatus[row.status] = Number(row.count);
    }

    // Query each group's tasks in parallel
    const results = await Promise.all(
      groups.map(async (group) => {
        const limit = group.limit ?? 50;
        const offset = group.offset ?? 0;

        const groupTasks = await this.db
          .select()
          .from(tasks)
          .where(and(...baseConditions, inArray(tasks.status, group.statuses)))
          .orderBy(desc(tasks.createdAt))
          .limit(limit)
          .offset(offset);

        const total = group.statuses.reduce((sum, s) => sum + (countByStatus[s] || 0), 0);

        return {
          hasMore: offset + groupTasks.length < total,
          key: group.key,
          limit,
          offset,
          tasks: groupTasks,
          total,
        };
      }),
    );

    return results;
  }

  async list(options?: {
    assigneeAgentId?: string;
    limit?: number;
    offset?: number;
    parentTaskId?: string | null;
    priorities?: number[];
    statuses?: string[];
  }): Promise<{ tasks: TaskItem[]; total: number }> {
    const {
      statuses,
      priorities,
      parentTaskId,
      assigneeAgentId,
      limit = 50,
      offset = 0,
    } = options || {};

    const conditions = [this.ownership()];

    if (statuses?.length) conditions.push(inArray(tasks.status, statuses));
    if (priorities?.length) conditions.push(inArray(tasks.priority, priorities));
    if (assigneeAgentId) conditions.push(eq(tasks.assigneeAgentId, assigneeAgentId));

    if (parentTaskId === null) {
      conditions.push(isNull(tasks.parentTaskId));
    } else if (parentTaskId) {
      conditions.push(eq(tasks.parentTaskId, parentTaskId));
    }

    const where = and(...conditions);

    const countResult = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(tasks)
      .where(where);

    const taskList = await this.db
      .select()
      .from(tasks)
      .where(where)
      .orderBy(desc(tasks.createdAt))
      .limit(limit)
      .offset(offset);

    return { tasks: taskList, total: Number(countResult[0].count) };
  }

  /**
   * Batch update sortOrder for multiple tasks.
   * @param order Array of { id, sortOrder } pairs
   */
  async reorder(order: Array<{ id: string; sortOrder: number }>): Promise<void> {
    for (const item of order) {
      await this.db
        .update(tasks)
        .set({ sortOrder: item.sortOrder, updatedAt: new Date() })
        .where(and(eq(tasks.id, item.id), this.ownership()));
    }
  }

  async findSubtasks(parentTaskId: string): Promise<TaskItem[]> {
    return this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.parentTaskId, parentTaskId), this.ownership()))
      .orderBy(tasks.sortOrder, tasks.seq);
  }

  /**
   * Fetch all descendants of a root task using Drizzle select() (returns camelCase fields).
   * Uses breadth-first traversal with O(depth) queries.
   */
  async findAllDescendants(rootTaskId: string): Promise<TaskItem[]> {
    const all: TaskItem[] = [];
    let parentIds = [rootTaskId];

    while (parentIds.length > 0) {
      const children = await this.db
        .select()
        .from(tasks)
        .where(and(inArray(tasks.parentTaskId, parentIds), this.ownership()))
        .orderBy(tasks.sortOrder, tasks.seq);

      if (children.length === 0) break;

      all.push(...children);
      parentIds = children.map((c) => c.id);
    }

    return all;
  }

  // Recursive query to get full task tree
  async getTaskTree(rootTaskId: string): Promise<TaskItem[]> {
    const ownership = this.ownershipSql();
    const result = await this.db.execute(sql`
      WITH RECURSIVE task_tree AS (
        SELECT * FROM tasks WHERE id = ${rootTaskId} AND ${ownership}
        UNION ALL
        SELECT t.* FROM tasks t
        JOIN task_tree tt ON t.parent_task_id = tt.id
      )
      SELECT * FROM task_tree
    `);

    return result.rows as unknown as TaskItem[];
  }

  /**
   * For a list of task IDs, find all agent IDs (assignee + creator) across their full task trees.
   * Walks UP to find root, then DOWN to collect all agents.
   * Returns { [inputTaskId]: agentId[] }
   */
  async getTreeAgentIdsForTaskIds(taskIds: string[]): Promise<Record<string, string[]>> {
    if (taskIds.length === 0) return {};

    const taskIdParams = taskIds.map((id) => sql`${id}`);
    const taskIdList = sql.join(taskIdParams, sql`, `);

    const ownershipBare = this.ownershipSql();
    const ownershipAliased = this.ownershipSql('t');
    const result = await this.db.execute(sql`
      WITH RECURSIVE
      ancestors AS (
        SELECT id AS origin_id, id, parent_task_id
        FROM tasks
        WHERE id IN (${taskIdList})
          AND ${ownershipBare}
        UNION ALL
        SELECT a.origin_id, t.id, t.parent_task_id
        FROM tasks t
        JOIN ancestors a ON t.id = a.parent_task_id
        WHERE ${ownershipAliased}
      ),
      roots AS (
        SELECT DISTINCT ON (origin_id) origin_id, id AS root_id
        FROM ancestors
        WHERE parent_task_id IS NULL
      ),
      descendants AS (
        SELECT r.origin_id, t.id, t.assignee_agent_id, t.created_by_agent_id
        FROM tasks t
        JOIN roots r ON t.id = r.root_id
        WHERE ${ownershipAliased}
        UNION ALL
        SELECT d.origin_id, t.id, t.assignee_agent_id, t.created_by_agent_id
        FROM tasks t
        JOIN descendants d ON t.parent_task_id = d.id
        WHERE ${ownershipAliased}
      )
      SELECT origin_id, assignee_agent_id, created_by_agent_id
      FROM descendants
      WHERE assignee_agent_id IS NOT NULL OR created_by_agent_id IS NOT NULL
    `);

    const map: Record<string, Set<string>> = {};
    for (const row of result.rows as any[]) {
      const originId = row.origin_id as string;
      if (!map[originId]) map[originId] = new Set();
      if (row.assignee_agent_id) map[originId].add(row.assignee_agent_id as string);
      if (row.created_by_agent_id) map[originId].add(row.created_by_agent_id as string);
    }

    return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, Array.from(v)]));
  }

  // ========== Status ==========

  async updateStatus(
    id: string,
    status: string,
    extra?: { completedAt?: Date; error?: string | null; startedAt?: Date },
  ): Promise<TaskItem | null> {
    return this.update(id, { status, ...extra });
  }

  async batchUpdateStatus(ids: string[], status: string): Promise<number> {
    const result = await this.db
      .update(tasks)
      .set({ status, updatedAt: new Date() })
      .where(and(inArray(tasks.id, ids), this.ownership()))
      .returning();

    return result.length;
  }

  // ========== Config ==========

  /**
   * Safely merge-update the task's config object.
   * Reads the current config, shallow-merges the incoming partial, and writes back.
   */
  async updateTaskConfig(id: string, partial: Record<string, unknown>): Promise<TaskItem | null> {
    const task = await this.findById(id);
    if (!task) return null;

    const current = (task.config as Record<string, unknown>) || {};
    const config = merge(current, partial);
    return this.update(id, { config });
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
    return (task.config as Record<string, any>)?.checkpoint || {};
  }

  async updateCheckpointConfig(id: string, checkpoint: CheckpointConfig): Promise<TaskItem | null> {
    return this.updateTaskConfig(id, { checkpoint });
  }

  // ========== Review Config ==========

  getReviewConfig(task: TaskItem): Record<string, any> | undefined {
    return (task.config as Record<string, any>)?.review;
  }

  async updateReviewConfig(id: string, review: Record<string, any>): Promise<TaskItem | null> {
    return this.updateTaskConfig(id, { review });
  }

  // ========== Verify Config ==========

  /**
   * Read this task's own verify config from `config.verify`. During the
   * migration window it falls back to the legacy `config.review` key so tasks
   * configured before the verify cutover still surface their gate settings —
   * only the shared `enabled` / `maxIterations` fields carry over (review's
   * inline rubrics are dropped, no data was using them).
   */
  getVerifyConfig(task: TaskItem): TaskVerifyConfig | undefined {
    const config = task.config as Record<string, any> | undefined;
    if (config?.verify) return config.verify as TaskVerifyConfig;

    const review = config?.review as Record<string, any> | undefined;
    if (review && (review.enabled !== undefined || review.maxIterations !== undefined)) {
      return { enabled: review.enabled, maxIterations: review.maxIterations };
    }
    return undefined;
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

  /**
   * Patch the task's own `config.verify`. Per-key semantics (a plain deep-merge
   * can't express "remove", and JSON can't transmit `undefined`):
   * - `null`      → clear the key (e.g. switch a rubric/verifier back to default)
   * - omitted     → leave the existing value untouched
   * - any value   → set it (arrays replace wholesale, not index-merged)
   *
   * The merge is scoped to the `verify` sub-object so sibling config keys
   * (model, checkpoint, schedule, …) are preserved.
   */
  async updateVerifyConfig(
    id: string,
    patch: { [K in keyof TaskVerifyConfig]?: TaskVerifyConfig[K] | null },
  ): Promise<TaskItem | null> {
    const task = await this.findById(id);
    if (!task) return null;

    const config = (task.config as Record<string, any>) || {};
    const next: Record<string, any> = { ...(config.verify as TaskVerifyConfig | undefined) };

    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete next[key];
      else if (value !== undefined) next[key] = value;
    }

    return this.update(id, { config: { ...config, verify: next } });
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
    await this.db
      .update(tasks)
      .set({ lastHeartbeatAt: new Date(), updatedAt: new Date() })
      .where(and(eq(tasks.id, id), this.ownership()));
  }

  // Tasks eligible for cron-based dispatch.
  // Excludes terminal/paused/running — `paused` requires user attention,
  // `running` is already in flight (and `runTask` would CONFLICT anyway).
  static async getScheduledTasks(db: LobeChatDatabase): Promise<TaskItem[]> {
    return db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.automationMode, 'schedule'),
          isNotNull(tasks.schedulePattern),
          notInArray(tasks.status, ['canceled', 'completed', 'failed', 'paused', 'running']),
        ),
      );
  }

  // Find stuck tasks (running but heartbeat timed out)
  // Only checks tasks that have both lastHeartbeatAt and heartbeatTimeout set
  static async findStuckTasks(db: LobeChatDatabase): Promise<TaskItem[]> {
    return db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.status, 'running'),
          isNotNull(tasks.lastHeartbeatAt),
          isNotNull(tasks.heartbeatTimeout),
          sql`${tasks.lastHeartbeatAt} < now() - make_interval(secs => ${tasks.heartbeatTimeout})`,
        ),
      );
  }

  // ========== Dependencies ==========

  private depsOwnership = () =>
    this.childOwnership({
      userId: taskDependencies.userId,
      workspaceId: taskDependencies.workspaceId,
    });

  async addDependency(taskId: string, dependsOnId: string, type: string = 'blocks'): Promise<void> {
    await this.db
      .insert(taskDependencies)
      .values({
        dependsOnId,
        taskId,
        type,
        userId: this.userId,
        workspaceId: this.workspaceId ?? null,
      })
      .onConflictDoNothing();
  }

  async removeDependency(taskId: string, dependsOnId: string): Promise<void> {
    await this.db
      .delete(taskDependencies)
      .where(
        and(
          eq(taskDependencies.taskId, taskId),
          eq(taskDependencies.dependsOnId, dependsOnId),
          this.depsOwnership(),
        ),
      );
  }

  async getDependencies(taskId: string) {
    return this.db
      .select()
      .from(taskDependencies)
      .where(and(eq(taskDependencies.taskId, taskId), this.depsOwnership()));
  }

  async getDependenciesByTaskIds(taskIds: string[]) {
    if (taskIds.length === 0) return [];
    return this.db
      .select()
      .from(taskDependencies)
      .where(and(inArray(taskDependencies.taskId, taskIds), this.depsOwnership()));
  }

  async getDependents(taskId: string) {
    return this.db
      .select()
      .from(taskDependencies)
      .where(and(eq(taskDependencies.dependsOnId, taskId), this.depsOwnership()));
  }

  // Check if all dependencies of a task are completed
  async areAllDependenciesCompleted(taskId: string): Promise<boolean> {
    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(taskDependencies)
      .innerJoin(tasks, eq(taskDependencies.dependsOnId, tasks.id))
      .where(
        and(
          eq(taskDependencies.taskId, taskId),
          eq(taskDependencies.type, 'blocks'),
          ne(tasks.status, 'completed'),
          this.depsOwnership(),
        ),
      );

    return Number(result[0].count) === 0;
  }

  // Find tasks that are now unblocked after a dependency completes
  async getUnlockedTasks(completedTaskId: string): Promise<TaskItem[]> {
    // Find all tasks that depend on the completed task
    const dependents = await this.getDependents(completedTaskId);
    const unlocked: TaskItem[] = [];

    for (const dep of dependents) {
      if (dep.type !== 'blocks') continue;

      // Check if ALL dependencies of this task are now completed
      const allDone = await this.areAllDependenciesCompleted(dep.taskId);
      if (!allDone) continue;

      // Get the task itself — only unlock if it's in backlog
      const task = await this.findById(dep.taskId);
      if (task && task.status === 'backlog') {
        unlocked.push(task);
      }
    }

    return unlocked;
  }

  // Check if all subtasks of a parent task are completed
  async areAllSubtasksCompleted(parentTaskId: string): Promise<boolean> {
    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(tasks)
      .where(
        and(eq(tasks.parentTaskId, parentTaskId), ne(tasks.status, 'completed'), this.ownership()),
      );

    return Number(result[0].count) === 0;
  }

  // ========== Documents (MVP Workspace) ==========

  private docsOwnership = () =>
    this.childOwnership({
      userId: taskDocuments.userId,
      workspaceId: taskDocuments.workspaceId,
    });

  async pinDocument(taskId: string, documentId: string, pinnedBy: string = 'agent'): Promise<void> {
    await this.db
      .insert(taskDocuments)
      .values({
        documentId,
        pinnedBy,
        taskId,
        userId: this.userId,
        workspaceId: this.workspaceId ?? null,
      })
      .onConflictDoNothing();
  }

  async unpinDocument(taskId: string, documentId: string): Promise<void> {
    await this.db
      .delete(taskDocuments)
      .where(
        and(
          eq(taskDocuments.taskId, taskId),
          eq(taskDocuments.documentId, documentId),
          this.docsOwnership(),
        ),
      );
  }

  async getPinnedDocuments(taskId: string) {
    return this.db
      .select()
      .from(taskDocuments)
      .where(and(eq(taskDocuments.taskId, taskId), this.docsOwnership()))
      .orderBy(taskDocuments.createdAt);
  }

  /**
   * Documents pinned to a task at or after a given timestamp, joined with the
   * `documents` table so callers receive `{ id, kind, title }` directly.
   *
   * Used by topic-brief synthesis to attribute artifacts to the topic that
   * just completed: pass the topic's start time as `since`.
   */
  async getDocumentsPinnedSince(
    taskId: string,
    since: Date,
  ): Promise<{ id: string; kind: string | null; title: string | null }[]> {
    const rows = await this.db
      .select({
        fileType: documents.fileType,
        id: documents.id,
        title: documents.title,
      })
      .from(taskDocuments)
      .innerJoin(documents, eq(taskDocuments.documentId, documents.id))
      .where(
        and(
          eq(taskDocuments.taskId, taskId),
          this.docsOwnership(),
          gte(taskDocuments.createdAt, since),
        ),
      );

    return rows.map((row) => ({
      id: row.id,
      kind: row.fileType ?? null,
      title: row.title ?? null,
    }));
  }

  // Get all pinned docs from a task tree (recursive), returns nodeMap + tree structure
  async getTreePinnedDocuments(rootTaskId: string): Promise<WorkspaceData> {
    const rootOwnership = this.ownershipSql();
    const recursiveOwnership = this.ownershipSql('t');
    const docsOwnership = this.workspaceId
      ? sql`td.workspace_id = ${this.workspaceId}`
      : sql`td.user_id = ${this.userId} AND td.workspace_id IS NULL`;
    const result = await this.db.execute(sql`
      WITH RECURSIVE task_tree AS (
        SELECT id, identifier FROM tasks WHERE id = ${rootTaskId} AND ${rootOwnership}
        UNION ALL
        SELECT t.id, t.identifier FROM tasks t
        JOIN task_tree tt ON t.parent_task_id = tt.id
        WHERE ${recursiveOwnership}
      )
      SELECT td.*, tt.id as source_task_id, tt.identifier as source_task_identifier,
             d.title as document_title, d.file_type as document_file_type, d.parent_id as document_parent_id,
             d.total_char_count as document_char_count, d.updated_at as document_updated_at
      FROM task_documents td
      JOIN task_tree tt ON td.task_id = tt.id
      LEFT JOIN documents d ON td.document_id = d.id
      WHERE ${docsOwnership}
      ORDER BY td.created_at
    `);

    // Build nodeMap
    const nodeMap: Record<string, WorkspaceDocNode> = {};

    const docIds = new Set<string>();

    for (const row of result.rows as any[]) {
      const docId = row.document_id;
      docIds.add(docId);
      nodeMap[docId] = {
        charCount: row.document_char_count,
        createdAt: row.created_at,
        fileType: row.document_file_type,
        parentId: row.document_parent_id,
        pinnedBy: row.pinned_by,
        sourceTaskId: row.source_task_id,
        sourceTaskIdentifier: row.source_task_id !== rootTaskId ? row.source_task_identifier : null,
        title: row.document_title || 'Untitled',
        updatedAt: row.document_updated_at,
      };
    }

    // Build tree (children as id references)
    type TreeNode = WorkspaceTreeNode;

    const childrenMap = new Map<string | null, TreeNode[]>();
    for (const docId of docIds) {
      const node = nodeMap[docId];
      const parentId = node.parentId && docIds.has(node.parentId) ? node.parentId : null;
      const list = childrenMap.get(parentId) || [];
      list.push({ children: [], id: docId });
      childrenMap.set(parentId, list);
    }

    const buildTree = (parentId: string | null): TreeNode[] => {
      const nodes = childrenMap.get(parentId) || [];
      for (const node of nodes) {
        node.children = buildTree(node.id);
      }
      return nodes;
    };

    return { nodeMap, tree: buildTree(null) };
  }

  // ========== Topic Management ==========

  async incrementTopicCount(id: string): Promise<void> {
    await this.db
      .update(tasks)
      .set({
        totalTopics: sql`${tasks.totalTopics} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(tasks.id, id), this.ownership()));
  }

  async updateCurrentTopic(id: string, topicId: string): Promise<void> {
    await this.db
      .update(tasks)
      .set({ currentTopicId: topicId, updatedAt: new Date() })
      .where(and(eq(tasks.id, id), this.ownership()));
  }

  // ========== Comments ==========

  private commentsOwnership = () =>
    this.childOwnership({
      userId: taskComments.userId,
      workspaceId: taskComments.workspaceId,
    });

  async addComment(data: Omit<NewTaskComment, 'id'>): Promise<TaskCommentItem> {
    const [comment] = await this.db
      .insert(taskComments)
      .values({ ...data, workspaceId: this.workspaceId ?? null })
      .returning();
    return comment;
  }

  async getComments(taskId: string): Promise<TaskCommentItem[]> {
    return this.db
      .select()
      .from(taskComments)
      .where(and(eq(taskComments.taskId, taskId), this.commentsOwnership()))
      .orderBy(taskComments.createdAt);
  }

  async deleteComment(id: string): Promise<boolean> {
    const result = await this.db
      .delete(taskComments)
      .where(and(eq(taskComments.id, id), this.commentsOwnership()))
      .returning();
    return result.length > 0;
  }

  async updateComment(
    id: string,
    content: string,
    opts?: { editorData?: unknown },
  ): Promise<TaskCommentItem | undefined> {
    const [comment] = await this.db
      .update(taskComments)
      .set({
        content,
        ...(opts?.editorData !== undefined ? { editorData: opts.editorData as never } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(taskComments.id, id), this.commentsOwnership()))
      .returning();
    return comment;
  }

  // ========== Transfer / Copy ==========

  /**
   * Collect a task and all its descendants (parentTaskId-linked) via BFS.
   * Honors the current ownership scope.
   */
  private async collectTaskSubtree(rootId: string, runner: LobeChatDatabase): Promise<TaskItem[]> {
    const [root] = await runner
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, rootId), this.ownership()))
      .limit(1);
    if (!root) return [];

    const collected: TaskItem[] = [root];
    let frontier: string[] = [root.id];

    while (frontier.length > 0) {
      const children = await runner
        .select()
        .from(tasks)
        .where(and(inArray(tasks.parentTaskId, frontier), this.ownership()));
      if (children.length === 0) break;
      collected.push(...children);
      frontier = children.map((c) => c.id);
    }

    return collected;
  }

  /**
   * Allocate a contiguous block of seq numbers + identifiers in the target
   * scope. Returns the next available seq baseline.
   */
  private async nextSeqIn(
    runner: LobeChatDatabase,
    targetWorkspaceId: string | null,
    targetUserId: string,
  ): Promise<number> {
    const where = targetWorkspaceId
      ? eq(tasks.workspaceId, targetWorkspaceId)
      : and(eq(tasks.createdByUserId, targetUserId), isNull(tasks.workspaceId));
    const [{ maxSeq }] = await runner
      .select({ maxSeq: sql<number>`COALESCE(MAX(${tasks.seq}), 0)` })
      .from(tasks)
      .where(where!);
    return Number(maxSeq) + 1;
  }

  /**
   * Transfer a task subtree to another workspace / personal scope. Reallocates
   * `identifier`/`seq` in the target scope and rewrites every dependent child
   * table (`task_dependencies`, `task_documents`, `task_topics`,
   * `task_comments`, `briefs`) so the ownership predicates remain consistent.
   *
   * Cross-scope references that may no longer be valid are cleared:
   *   - `assigneeAgentId` (workspace move: agent likely doesn't exist there)
   *   - `currentTopicId` (topic ownership is also moving but the link is
   *     reset to avoid surfacing a stale active topic in the new scope)
   */
  async transferTo(
    taskId: string,
    targetWorkspaceId: string | null,
    targetUserId: string,
  ): Promise<{ taskIds: string[] }> {
    return this.db.transaction(async (trx) => {
      const scoped = new TaskModel(trx as LobeChatDatabase, this.userId, this.workspaceId);
      const subtree = await scoped.collectTaskSubtree(taskId, trx as LobeChatDatabase);
      if (subtree.length === 0) throw new Error('Task not found');

      const ids = subtree.map((t) => t.id);

      // Reallocate identifier + seq in target scope to avoid collisions.
      const baseSeq = await this.nextSeqIn(
        trx as LobeChatDatabase,
        targetWorkspaceId,
        targetUserId,
      );
      // Update each task individually because identifier/seq are per-row.
      for (const [idx, task] of subtree.entries()) {
        const seq = baseSeq + idx;
        const identifier = `T-${seq}`;
        await (trx as LobeChatDatabase)
          .update(tasks)
          .set({
            // Clear cross-scope refs: agent / topic may be invalid in new scope.
            assigneeAgentId: targetWorkspaceId === this.workspaceId ? task.assigneeAgentId : null,
            createdByUserId: targetUserId,
            currentTopicId: null,
            identifier,
            seq,
            updatedAt: new Date(),
            workspaceId: targetWorkspaceId,
          })
          .where(eq(tasks.id, task.id));
      }

      // Update child tables that key off taskId.
      const ownershipUpdate = { userId: targetUserId, workspaceId: targetWorkspaceId };
      await (trx as LobeChatDatabase)
        .update(taskDependencies)
        .set(ownershipUpdate)
        .where(inArray(taskDependencies.taskId, ids));
      await (trx as LobeChatDatabase)
        .update(taskDocuments)
        .set(ownershipUpdate)
        .where(inArray(taskDocuments.taskId, ids));
      await (trx as LobeChatDatabase)
        .update(taskComments)
        .set(ownershipUpdate)
        .where(inArray(taskComments.taskId, ids));

      return { taskIds: ids };
    });
  }

  /**
   * Deep clone a task subtree into another workspace / personal scope. Fresh
   * ids, fresh identifiers, preserved parent/child topology. Cross-scope refs
   * (agent / topic / brief / current topic) are cleared on the clones so the
   * copies start clean in the new scope.
   */
  async copyToWorkspace(
    taskId: string,
    targetWorkspaceId: string | null,
    targetUserId: string,
  ): Promise<{ rootId: string }> {
    return this.db.transaction(async (trx) => {
      const scoped = new TaskModel(trx as LobeChatDatabase, this.userId, this.workspaceId);
      const subtree = await scoped.collectTaskSubtree(taskId, trx as LobeChatDatabase);
      if (subtree.length === 0) throw new Error('Task not found');

      // BFS clone — parent inserted before children, so we always know the
      // new parentTaskId by the time we reach the child.
      const idMap = new Map<string, string>();
      const byId = new Map(subtree.map((t) => [t.id, t]));
      const queue: string[] = [taskId];
      const seen = new Set<string>();

      let seq = await this.nextSeqIn(trx as LobeChatDatabase, targetWorkspaceId, targetUserId);

      while (queue.length > 0) {
        const currentId = queue.shift()!;
        if (seen.has(currentId)) continue;
        seen.add(currentId);
        const original = byId.get(currentId);
        if (!original) continue;

        const newParentId =
          currentId === taskId ? null : (idMap.get(original.parentTaskId!) ?? null);

        const identifier = `T-${seq}`;
        const inserted = (await (trx as LobeChatDatabase)
          .insert(tasks)
          .values({
            assigneeAgentId: null,
            assigneeUserId: null,
            automationMode: original.automationMode,
            config: original.config ?? {},
            context: {
              ...(original.context as Record<string, unknown>),
              duplicatedFrom: original.id,
            },
            createdByAgentId: null,
            createdByUserId: targetUserId,
            currentTopicId: null,
            description: original.description,
            error: null,
            heartbeatInterval: original.heartbeatInterval,
            heartbeatTimeout: original.heartbeatTimeout,
            identifier,
            instruction: original.instruction,
            maxTopics: original.maxTopics,
            name: original.name,
            parentTaskId: newParentId,
            priority: original.priority,
            schedulePattern: original.schedulePattern,
            scheduleTimezone: original.scheduleTimezone,
            seq,
            sortOrder: original.sortOrder,
            // Reset lifecycle: copy starts fresh, not mid-run.
            status: 'backlog',
            totalTopics: 0,
            workspaceId: targetWorkspaceId,
          } as NewTask)
          .returning({ id: tasks.id })) as { id: string }[];

        idMap.set(original.id, inserted[0]!.id);
        seq++;

        for (const c of subtree) {
          if (c.parentTaskId === original.id) queue.push(c.id);
        }
      }

      return { rootId: idMap.get(taskId)! };
    });
  }
}
