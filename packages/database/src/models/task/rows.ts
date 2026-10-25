import type { NewTask, TaskItem } from '@lobechat/types';
import { and, eq, inArray, ne, or, sql } from 'drizzle-orm';

import { tasks } from '../../schemas/task';
import type { LobeChatDatabase } from '../../type';
import { seqOwnership, type TaskModelContext, taskOwnership } from './context';
import { isTaskIdentifierUniqueViolation, normalizeTaskRefs } from './utils';

/**
 * Insert a task under the next free `seq` in scope, retrying when a concurrent
 * create took the same identifier first.
 */
export const insertWithNextSeq = async (
  ctx: TaskModelContext,
  createData: Omit<NewTask, 'id' | 'identifier' | 'seq' | 'createdByUserId'>,
  identifierPrefix: string,
  maxRetries: number,
): Promise<TaskItem> => {
  // Retry loop to handle concurrent creates (parallel tool calls)
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Seq is allocated per ownership scope: workspace-wide in team mode,
      // user-private in personal mode. This keeps `T-N` identifiers stable
      // within the surface the user actually sees.
      //
      // Note: this uses `seqOwnership` (visibility-blind), NOT the regular
      // `ownership()`, because the `(workspace_id, identifier)` unique
      // constraint is workspace-wide and ignores visibility. If we let the
      // seq lookup filter out private rows, a private creator would compute
      // a max seq that skips another member's existing identifier and hit
      // PG error 23505 on insert.
      const seqResult = await ctx.db
        .select({ maxSeq: sql<number>`COALESCE(MAX(${tasks.seq}), 0)` })
        .from(tasks)
        .where(seqOwnership(ctx));

      const nextSeq = Number(seqResult[0].maxSeq) + 1;
      const identifier = `${identifierPrefix}-${nextSeq}`;

      const [task] = await ctx.db
        .insert(tasks)
        .values({
          ...createData,
          createdByUserId: ctx.userId,
          identifier,
          seq: nextSeq,
          workspaceId: ctx.workspaceId ?? null,
        } as NewTask)
        .returning();

      return task;
    } catch (error: any) {
      // Retry on unique constraint violation (concurrent seq conflict)
      // Check error itself, cause, and stringified message for PG error code 23505
      if (isTaskIdentifierUniqueViolation(error) && attempt < maxRetries - 1) {
        continue;
      }
      throw error;
    }
  }

  throw new Error('Failed to create task after max retries');
};

export const findById = async (ctx: TaskModelContext, id: string): Promise<TaskItem | null> => {
  const result = await ctx.db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), taskOwnership(ctx)))
    .limit(1);

  return result[0] || null;
};

export const findByIds = async (ctx: TaskModelContext, ids: string[]): Promise<TaskItem[]> => {
  if (ids.length === 0) return [];
  return ctx.db
    .select()
    .from(tasks)
    .where(and(inArray(tasks.id, ids), taskOwnership(ctx)));
};

/**
 * Only the assignee of each task. For callers on a polling path (the goal
 * graph re-reads every few seconds while a goal advances) that would
 * otherwise pull full rows — instruction, editor data, context, config — for
 * up to hundreds of tasks just to read one column.
 */
export const findAssigneesByIds = async (
  ctx: TaskModelContext,
  ids: string[],
): Promise<{ assigneeAgentId: string | null; id: string }[]> => {
  if (ids.length === 0) return [];
  return ctx.db
    .select({ assigneeAgentId: tasks.assigneeAgentId, id: tasks.id })
    .from(tasks)
    .where(and(inArray(tasks.id, ids), taskOwnership(ctx)));
};

export const resolveMany = async (
  ctx: TaskModelContext,
  idsOrIdentifiers: string[],
): Promise<TaskItem[]> => {
  if (idsOrIdentifiers.length === 0) return [];
  const identifiers = idsOrIdentifiers.map((value) => value.toUpperCase());
  return ctx.db
    .select()
    .from(tasks)
    .where(
      and(
        or(inArray(tasks.id, idsOrIdentifiers), inArray(tasks.identifier, identifiers)),
        taskOwnership(ctx),
      ),
    );
};

export const findByIdentifier = async (
  ctx: TaskModelContext,
  identifier: string,
): Promise<TaskItem | null> => {
  const result = await ctx.db
    .select()
    .from(tasks)
    .where(and(eq(tasks.identifier, identifier), taskOwnership(ctx)))
    .limit(1);

  return result[0] || null;
};

/** The column write itself — the assignee rule lives in `update`. */
export const writeRow = async (
  ctx: TaskModelContext,
  db: LobeChatDatabase,
  id: string,
  data: Partial<Omit<NewTask, 'id' | 'identifier' | 'seq' | 'createdByUserId'>>,
): Promise<TaskItem | null> => {
  const updated = await db
    .update(tasks)
    .set({ ...normalizeTaskRefs(data), updatedAt: new Date() })
    .where(and(eq(tasks.id, id), taskOwnership(ctx)))
    .returning();
  return updated[0] || null;
};

/**
 * Delete a task. This does NOT touch the task's Work artifact: the Work
 * lifecycle is driven by the deleteTask tool call at the tool-execution
 * dispatch layer (which calls `WorkModel.deleteTaskWork`), so non-tool deletes
 * (UI / CLI / deleteAll) deliberately leave the Work as an orphan for the UI
 * to render as "resource deleted" from its version snapshot. See.
 */
export const deleteTask = async (ctx: TaskModelContext, id: string): Promise<boolean> => {
  const deleted = await ctx.db
    .delete(tasks)
    .where(and(eq(tasks.id, id), taskOwnership(ctx)))
    .returning({ id: tasks.id });

  return deleted.length > 0;
};

/**
 * Count workspace tasks that would break if the given agent were demoted to
 * private:
 *   - public tasks assigned to it — a public task must never reference a
 *     private agent (`assertAgentVisibilityCompat`);
 *   - tasks created by anyone other than the agent's owner (any visibility)
 *     — after demotion those creators can no longer resolve the assignee,
 *     so their runs and assignee updates fail.
 * Deliberately workspace-wide and visibility-blind (NOT `ownership()`):
 * other members' private tasks are invisible to the caller but still lose
 * their assignee. Backs the router-level agent demotion guard.
 */
export const countTasksBlockingAgentDemotion = async (
  ctx: TaskModelContext,
  assigneeAgentId: string,
  agentOwnerUserId: string,
): Promise<number> => {
  if (!ctx.workspaceId) return 0;
  const [row] = await ctx.db
    .select({ count: sql<number>`count(*)` })
    .from(tasks)
    .where(
      and(
        eq(tasks.workspaceId, ctx.workspaceId),
        eq(tasks.assigneeAgentId, assigneeAgentId),
        or(eq(tasks.visibility, 'public'), ne(tasks.createdByUserId, agentOwnerUserId)),
      ),
    );
  return Number(row?.count ?? 0);
};

/**
 * Whether the subtree rooted at `rootTaskId` (root excluded) contains tasks
 * created by someone other than `creatorUserId`. Deliberately workspace-wide
 * and visibility-blind: other members' private subtasks are invisible to the
 * caller but would still be fractured by a public→private demotion (each row
 * stays owned by its creator, so the root creator loses those descendants
 * while their creators keep orphaned children whose parent is hidden).
 * Backs the router-level task demotion guard.
 */
export const subtreeHasOtherCreators = async (
  ctx: TaskModelContext,
  rootTaskId: string,
  creatorUserId: string,
): Promise<boolean> => {
  if (!ctx.workspaceId) return false;
  const result = await ctx.db.execute(sql`
    WITH RECURSIVE task_tree AS (
      SELECT id, created_by_user_id FROM tasks
        WHERE id = ${rootTaskId} AND workspace_id = ${ctx.workspaceId}
      UNION ALL
      SELECT t.id, t.created_by_user_id FROM tasks t
      JOIN task_tree tt ON t.parent_task_id = tt.id
    )
    SELECT 1 AS hit FROM task_tree
    WHERE id <> ${rootTaskId} AND created_by_user_id <> ${creatorUserId}
    LIMIT 1
  `);
  return result.rows.length > 0;
};

/**
 * Row-lock the task for the rest of the enclosing transaction. Serializes a
 * run recording its topic against a delete deciding there is nothing left to
 * interrupt. Returns false when the task no longer exists.
 */
export const lockForUpdate = async (ctx: TaskModelContext, id: string): Promise<boolean> => {
  const rows = await ctx.db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, id), taskOwnership(ctx)))
    .for('update');

  return rows.length > 0;
};

/**
 * Delete a task only while it still has `status`. Lets a delete that
 * inspected the task's runs lose cleanly to a run that started meanwhile,
 * instead of removing the row out from under it.
 */
export const deleteIfStatus = async (
  ctx: TaskModelContext,
  id: string,
  status: string,
): Promise<boolean> => {
  const deleted = await ctx.db
    .delete(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.status, status), taskOwnership(ctx)))
    .returning({ id: tasks.id });

  return deleted.length > 0;
};

/** See {@link delete}: bulk task deletion likewise leaves Work artifacts intact. */
export const deleteAll = async (
  ctx: TaskModelContext,
  options?: { restrictToCreator?: boolean },
): Promise<number> => {
  // `restrictToCreator` narrows the workspace-wide sweep to rows the caller
  // created (non-owner members); owners/personal mode keep the full scope.
  const where = options?.restrictToCreator
    ? and(taskOwnership(ctx), eq(tasks.createdByUserId, ctx.userId))
    : taskOwnership(ctx);

  const result = await ctx.db.delete(tasks).where(where).returning({ id: tasks.id });
  return result.length;
};

/**
 * Batch update sortOrder for multiple tasks.
 * @param order Array of { id, sortOrder } pairs
 */
export const reorder = async (
  ctx: TaskModelContext,
  order: Array<{ id: string; sortOrder: number }>,
): Promise<void> => {
  for (const item of order) {
    await ctx.db
      .update(tasks)
      .set({ sortOrder: item.sortOrder, updatedAt: new Date() })
      .where(and(eq(tasks.id, item.id), taskOwnership(ctx)));
  }
};

/** Atomically transition a task only while it still has the expected status. */
export const updateStatusIfCurrent = async (
  ctx: TaskModelContext,
  id: string,
  currentStatus: string,
  status: string,
  extra?: { completedAt?: Date | null; error?: string | null; startedAt?: Date },
): Promise<TaskItem | null> => {
  const [task] = await ctx.db
    .update(tasks)
    .set({ status, updatedAt: new Date(), ...extra })
    .where(and(eq(tasks.id, id), eq(tasks.status, currentStatus), taskOwnership(ctx)))
    .returning();

  return task ?? null;
};

/** `context.completion.requestedByOperationId` — the run a deferred completion waits for. */
const completionRequest = sql`${tasks.context} -> 'completion' ->> 'requestedByOperationId'`;
const withoutCompletionRequest = sql`jsonb_set(${tasks.context}, '{completion,requestedByOperationId}', 'null'::jsonb)`;

/**
 * Completes a running task whose deferred completion `operationId` still holds,
 * consuming the request in the same write. Returns null when the request was
 * withdrawn (or the task left `running`) first.
 */
export const completeIfCompletionRequested = async (
  ctx: TaskModelContext,
  id: string,
  operationId: string,
): Promise<TaskItem | null> => {
  const [task] = await ctx.db
    .update(tasks)
    .set({
      completedAt: new Date(),
      context: withoutCompletionRequest,
      error: null,
      status: 'completed',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(tasks.id, id),
        eq(tasks.status, 'running'),
        sql`${completionRequest} = ${operationId}`,
        taskOwnership(ctx),
      ),
    )
    .returning();

  return task ?? null;
};

/**
 * Withdraws a running task's deferred completion by `operationId`. Returns
 * false when the run already consumed it (or the task left `running`).
 */
export const withdrawCompletionRequest = async (
  ctx: TaskModelContext,
  id: string,
  operationId: string,
): Promise<boolean> => {
  const updated = await ctx.db
    .update(tasks)
    .set({ context: withoutCompletionRequest, updatedAt: new Date() })
    .where(
      and(
        eq(tasks.id, id),
        eq(tasks.status, 'running'),
        sql`${completionRequest} = ${operationId}`,
        taskOwnership(ctx),
      ),
    )
    .returning({ id: tasks.id });

  return updated.length > 0;
};

export const batchUpdateStatus = async (
  ctx: TaskModelContext,
  ids: string[],
  status: string,
): Promise<number> => {
  const result = await ctx.db
    .update(tasks)
    .set({ status, updatedAt: new Date() })
    .where(and(inArray(tasks.id, ids), taskOwnership(ctx)))
    .returning();

  return result.length;
};

/**
 * Update a frozen set of task ids in one SQL statement so the family cannot
 * be left partially transitioned. Callers pass the exact ids they snapshotted
 * (and the user confirmed); a task that changes status concurrently is never
 * pulled into the update by a status re-query.
 */
export const updateStatusForIds = async (
  ctx: TaskModelContext,
  ids: string[],
  status: string,
  extra?: { completedAt?: Date; error?: string | null; startedAt?: Date },
): Promise<TaskItem[]> => {
  if (ids.length === 0) return [];
  return ctx.db
    .update(tasks)
    .set({ status, updatedAt: new Date(), ...extra })
    .where(and(inArray(tasks.id, ids), taskOwnership(ctx)))
    .returning();
};

export const updateHeartbeat = async (ctx: TaskModelContext, id: string): Promise<void> => {
  await ctx.db
    .update(tasks)
    .set({ lastHeartbeatAt: new Date(), updatedAt: new Date() })
    .where(and(eq(tasks.id, id), taskOwnership(ctx)));
};

export const incrementTopicCount = async (ctx: TaskModelContext, id: string): Promise<void> => {
  await ctx.db
    .update(tasks)
    .set({
      totalTopics: sql`${tasks.totalTopics} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(tasks.id, id), taskOwnership(ctx)));
};

export const updateCurrentTopic = async (
  ctx: TaskModelContext,
  id: string,
  topicId: string,
): Promise<void> => {
  await ctx.db
    .update(tasks)
    .set({ currentTopicId: topicId, updatedAt: new Date() })
    .where(and(eq(tasks.id, id), taskOwnership(ctx)));
};
