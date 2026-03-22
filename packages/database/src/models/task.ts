import type {
  CheckpointConfig,
  WorkspaceData,
  WorkspaceDocNode,
  WorkspaceTreeNode,
} from '@lobechat/types';
import { and, desc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';

import type { NewTask, NewTaskComment, TaskCommentItem, TaskItem } from '../schemas/task';
import { taskComments, taskDependencies, taskDocuments, tasks } from '../schemas/task';
import type { LobeChatDatabase } from '../type';

export class TaskModel {
  private readonly userId: string;
  private readonly db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

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
        // Get next seq for this user
        const seqResult = await this.db
          .select({ maxSeq: sql<number>`COALESCE(MAX(${tasks.seq}), 0)` })
          .from(tasks)
          .where(eq(tasks.createdByUserId, this.userId));

        const nextSeq = Number(seqResult[0].maxSeq) + 1;
        const identifier = `${identifierPrefix}-${nextSeq}`;

        const result = await this.db
          .insert(tasks)
          .values({
            ...rest,
            createdByUserId: this.userId,
            identifier,
            seq: nextSeq,
          } as NewTask)
          .returning();

        return result[0];
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
      .where(and(eq(tasks.id, id), eq(tasks.createdByUserId, this.userId)))
      .limit(1);

    return result[0] || null;
  }

  async findByIds(ids: string[]): Promise<TaskItem[]> {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(tasks)
      .where(and(inArray(tasks.id, ids), eq(tasks.createdByUserId, this.userId)));
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
      .where(and(eq(tasks.identifier, identifier), eq(tasks.createdByUserId, this.userId)))
      .limit(1);

    return result[0] || null;
  }

  async update(
    id: string,
    data: Partial<Omit<NewTask, 'id' | 'identifier' | 'seq' | 'createdByUserId'>>,
  ): Promise<TaskItem | null> {
    const result = await this.db
      .update(tasks)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(tasks.id, id), eq(tasks.createdByUserId, this.userId)))
      .returning();

    return result[0] || null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db
      .delete(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.createdByUserId, this.userId)))
      .returning();

    return result.length > 0;
  }

  async deleteAll(): Promise<number> {
    const result = await this.db
      .delete(tasks)
      .where(eq(tasks.createdByUserId, this.userId))
      .returning();

    return result.length;
  }

  // ========== Query ==========

  async list(options?: {
    assigneeAgentId?: string;
    limit?: number;
    offset?: number;
    parentTaskId?: string | null;
    status?: string;
  }): Promise<{ tasks: TaskItem[]; total: number }> {
    const { status, parentTaskId, assigneeAgentId, limit = 50, offset = 0 } = options || {};

    const conditions = [eq(tasks.createdByUserId, this.userId)];

    if (status) conditions.push(eq(tasks.status, status));
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
        .where(and(eq(tasks.id, item.id), eq(tasks.createdByUserId, this.userId)));
    }
  }

  async findSubtasks(parentTaskId: string): Promise<TaskItem[]> {
    return this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.parentTaskId, parentTaskId), eq(tasks.createdByUserId, this.userId)))
      .orderBy(tasks.sortOrder, tasks.seq);
  }

  // Recursive query to get full task tree
  async getTaskTree(rootTaskId: string): Promise<TaskItem[]> {
    const result = await this.db.execute(sql`
      WITH RECURSIVE task_tree AS (
        SELECT * FROM tasks WHERE id = ${rootTaskId} AND created_by_user_id = ${this.userId}
        UNION ALL
        SELECT t.* FROM tasks t
        JOIN task_tree tt ON t.parent_task_id = tt.id
      )
      SELECT * FROM task_tree
    `);

    return result.rows as TaskItem[];
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
      .where(and(inArray(tasks.id, ids), eq(tasks.createdByUserId, this.userId)))
      .returning();

    return result.length;
  }

  // ========== Checkpoint ==========

  getCheckpointConfig(task: TaskItem): CheckpointConfig {
    return (task.config as Record<string, any>)?.checkpoint || {};
  }

  async updateCheckpointConfig(id: string, checkpoint: CheckpointConfig): Promise<TaskItem | null> {
    const task = await this.findById(id);
    if (!task) return null;

    const config = { ...(task.config as Record<string, any>), checkpoint };
    return this.update(id, { config });
  }

  // ========== Review Config ==========

  getReviewConfig(task: TaskItem): Record<string, any> | undefined {
    return (task.config as Record<string, any>)?.review;
  }

  async updateReviewConfig(id: string, review: Record<string, any>): Promise<TaskItem | null> {
    const task = await this.findById(id);
    if (!task) return null;

    const config = { ...(task.config as Record<string, any>), review };
    return this.update(id, { config });
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
      .where(eq(tasks.id, id));
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

  async addDependency(taskId: string, dependsOnId: string, type: string = 'blocks'): Promise<void> {
    await this.db
      .insert(taskDependencies)
      .values({ dependsOnId, taskId, type, userId: this.userId })
      .onConflictDoNothing();
  }

  async removeDependency(taskId: string, dependsOnId: string): Promise<void> {
    await this.db
      .delete(taskDependencies)
      .where(
        and(eq(taskDependencies.taskId, taskId), eq(taskDependencies.dependsOnId, dependsOnId)),
      );
  }

  async getDependencies(taskId: string) {
    return this.db.select().from(taskDependencies).where(eq(taskDependencies.taskId, taskId));
  }

  async getDependenciesByTaskIds(taskIds: string[]) {
    if (taskIds.length === 0) return [];
    return this.db.select().from(taskDependencies).where(inArray(taskDependencies.taskId, taskIds));
  }

  async getDependents(taskId: string) {
    return this.db.select().from(taskDependencies).where(eq(taskDependencies.dependsOnId, taskId));
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
        and(
          eq(tasks.parentTaskId, parentTaskId),
          ne(tasks.status, 'completed'),
          eq(tasks.createdByUserId, this.userId),
        ),
      );

    return Number(result[0].count) === 0;
  }

  // ========== Documents (MVP Workspace) ==========

  async pinDocument(taskId: string, documentId: string, pinnedBy: string = 'agent'): Promise<void> {
    await this.db
      .insert(taskDocuments)
      .values({ documentId, pinnedBy, taskId, userId: this.userId })
      .onConflictDoNothing();
  }

  async unpinDocument(taskId: string, documentId: string): Promise<void> {
    await this.db
      .delete(taskDocuments)
      .where(and(eq(taskDocuments.taskId, taskId), eq(taskDocuments.documentId, documentId)));
  }

  async getPinnedDocuments(taskId: string) {
    return this.db
      .select()
      .from(taskDocuments)
      .where(eq(taskDocuments.taskId, taskId))
      .orderBy(taskDocuments.createdAt);
  }

  // Get all pinned docs from a task tree (recursive), returns nodeMap + tree structure
  async getTreePinnedDocuments(rootTaskId: string): Promise<WorkspaceData> {
    const result = await this.db.execute(sql`
      WITH RECURSIVE task_tree AS (
        SELECT id, identifier FROM tasks WHERE id = ${rootTaskId}
        UNION ALL
        SELECT t.id, t.identifier FROM tasks t
        JOIN task_tree tt ON t.parent_task_id = tt.id
      )
      SELECT td.*, tt.id as source_task_id, tt.identifier as source_task_identifier,
             d.title as document_title, d.file_type as document_file_type, d.parent_id as document_parent_id,
             d.total_char_count as document_char_count, d.updated_at as document_updated_at
      FROM task_documents td
      JOIN task_tree tt ON td.task_id = tt.id
      LEFT JOIN documents d ON td.document_id = d.id
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
      .where(eq(tasks.id, id));
  }

  async updateCurrentTopic(id: string, topicId: string): Promise<void> {
    await this.db
      .update(tasks)
      .set({ currentTopicId: topicId, updatedAt: new Date() })
      .where(eq(tasks.id, id));
  }

  // ========== Comments ==========

  async addComment(data: Omit<NewTaskComment, 'id'>): Promise<TaskCommentItem> {
    const [comment] = await this.db.insert(taskComments).values(data).returning();
    return comment;
  }

  // ========== Comments ==========

  async getComments(taskId: string): Promise<TaskCommentItem[]> {
    return this.db
      .select()
      .from(taskComments)
      .where(eq(taskComments.taskId, taskId))
      .orderBy(taskComments.createdAt);
  }

  async deleteComment(id: string): Promise<boolean> {
    const result = await this.db
      .delete(taskComments)
      .where(and(eq(taskComments.id, id), eq(taskComments.userId, this.userId)))

      .returning();
    return result.length > 0;
  }
}
