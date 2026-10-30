import type { TaskItem } from '@lobechat/types';
import { and, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';

import {
  taskActivities,
  taskComments,
  taskDependencies,
  taskDocuments,
  tasks,
  taskTopics,
} from '../../schemas/task';
import type { LobeChatDatabase } from '../../type';
import {
  activitiesOwnership,
  commentsOwnership,
  depsOwnership,
  docsOwnership,
  type TaskModelContext,
  taskOwnership,
  taskOwnershipSql,
  topicsOwnership,
} from './context';

export const findSubtasks = async (
  ctx: TaskModelContext,
  parentTaskId: string,
): Promise<TaskItem[]> => {
  return ctx.db
    .select()
    .from(tasks)
    .where(and(eq(tasks.parentTaskId, parentTaskId), taskOwnership(ctx)))
    .orderBy(tasks.sortOrder, tasks.seq);
};

/**
 * Fetch all descendants of a root task using Drizzle select() (returns camelCase fields).
 * Uses breadth-first traversal with O(depth) queries.
 */
export const findAllDescendants = async (
  ctx: TaskModelContext,
  rootTaskId: string,
): Promise<TaskItem[]> => {
  const all: TaskItem[] = [];
  let parentIds = [rootTaskId];

  while (parentIds.length > 0) {
    const children = await ctx.db
      .select()
      .from(tasks)
      .where(and(inArray(tasks.parentTaskId, parentIds), taskOwnership(ctx)))
      .orderBy(tasks.sortOrder, tasks.seq);

    if (children.length === 0) break;

    all.push(...children);
    parentIds = children.map((c) => c.id);
  }

  return all;
};

// Recursive query to get full task tree
export const getTaskTree = async (
  ctx: TaskModelContext,
  rootTaskId: string,
): Promise<TaskItem[]> => {
  const ownership = taskOwnershipSql(ctx);
  const result = await ctx.db.execute(sql`
    WITH RECURSIVE task_tree AS (
      SELECT * FROM tasks WHERE id = ${rootTaskId} AND ${ownership}
      UNION ALL
      SELECT t.* FROM tasks t
      JOIN task_tree tt ON t.parent_task_id = tt.id
    )
    SELECT * FROM task_tree
  `);

  return result.rows as unknown as TaskItem[];
};

/**
 * For a list of task IDs, find all agent IDs (assignee + creator) across their full task trees.
 * Walks UP to find root, then DOWN to collect all agents.
 * Returns { [inputTaskId]: agentId[] }
 */
export const getTreeAgentIdsForTaskIds = async (
  ctx: TaskModelContext,
  taskIds: string[],
): Promise<Record<string, string[]>> => {
  if (taskIds.length === 0) return {};

  const taskIdParams = taskIds.map((id) => sql`${id}`);
  const taskIdList = sql.join(taskIdParams, sql`, `);

  const ownershipBare = taskOwnershipSql(ctx);
  const ownershipAliased = taskOwnershipSql(ctx, 't');
  const result = await ctx.db.execute(sql`
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
};

/**
 * Collect a task and all its descendants (parentTaskId-linked) via BFS.
 * Honors the current ownership scope.
 */
export const collectTaskSubtree = async (
  ctx: TaskModelContext,
  rootId: string,
  runner: LobeChatDatabase,
): Promise<TaskItem[]> => {
  const [root] = await runner
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, rootId), taskOwnership(ctx)))
    .limit(1);
  if (!root) return [];

  const collected: TaskItem[] = [root];
  let frontier: string[] = [root.id];

  while (frontier.length > 0) {
    const children = await runner
      .select()
      .from(tasks)
      .where(and(inArray(tasks.parentTaskId, frontier), taskOwnership(ctx)));
    if (children.length === 0) break;
    collected.push(...children);
    frontier = children.map((c) => c.id);
  }

  return collected;
};

/**
 * Write one visibility onto a task subtree and the task-owned child rows that
 * mirror it, in one transaction. Only the task aggregate is written here; the
 * cross-aggregate flow (Work visibility mirror) lives in
 * `TaskSubtreeRepository.updateVisibility`, which runs this inside its own
 * transaction. `TaskSubtreeRepository.updateVisibility` documents the
 * cascade rules.
 */
export const setSubtreeVisibility = async (
  ctx: TaskModelContext,
  rootId: string,
  descendantIds: string[],
  visibility: 'private' | 'public',
): Promise<TaskItem | null> => {
  const taskIds = [rootId, ...descendantIds];
  const stamp = new Date();

  return ctx.db.transaction(async (tx) => {
    // A private task is creator-only, so a member assignee would keep a task
    // they can no longer open. Unassign them before the root is read back
    // below; the creator's own assignment and the agent assignee stay.
    if (visibility === 'private') {
      await tx
        .update(tasks)
        .set({ assigneeUserId: null })
        .where(
          and(
            inArray(tasks.id, taskIds),
            taskOwnership(ctx),
            isNotNull(tasks.assigneeUserId),
            ne(tasks.assigneeUserId, tasks.createdByUserId),
          ),
        );
    }

    // Update the root with RETURNING so we read the post-update row in the
    // same statement. A second SELECT filtered by `ownership()` would self-
    // cancel when a workspace owner demotes another member's task to private:
    // the UPDATE filter sees the OLD (public) row and writes, but the read-
    // back filter sees the NEW (private + other-creator) row and returns 0
    // rows, so the caller would observe a NOT_FOUND error even though the
    // write succeeded.
    const [updated] = await tx
      .update(tasks)
      .set({ updatedAt: stamp, visibility })
      .where(and(eq(tasks.id, rootId), taskOwnership(ctx)))
      .returning();

    if (descendantIds.length > 0) {
      await tx
        .update(tasks)
        .set({ updatedAt: stamp, visibility })
        .where(and(inArray(tasks.id, descendantIds), taskOwnership(ctx)));
    }

    await tx
      .update(taskDependencies)
      .set({ visibility })
      .where(and(inArray(taskDependencies.taskId, taskIds), depsOwnership(ctx)));

    await tx
      .update(taskDocuments)
      .set({ visibility })
      .where(and(inArray(taskDocuments.taskId, taskIds), docsOwnership(ctx)));

    // Demotion-only cascade for the event-shaped child rows (see the
    // `TaskSubtreeRepository.updateVisibility` docstring): their visibility
    // mirrors the task, so pulling the task back to private must also pull
    // public-era topics/comments out of workspace scope.
    if (visibility === 'private') {
      await tx
        .update(taskTopics)
        .set({ visibility })
        .where(and(inArray(taskTopics.taskId, taskIds), topicsOwnership(ctx)));

      await tx
        .update(taskComments)
        .set({ visibility })
        .where(and(inArray(taskComments.taskId, taskIds), commentsOwnership(ctx)));

      await tx
        .update(taskActivities)
        .set({ visibility })
        .where(and(inArray(taskActivities.taskId, taskIds), activitiesOwnership(ctx)));
    }

    return updated ?? null;
  });
};

/**
 * Delete the given tasks (owned child rows cascade through their FKs).
 * Acceptances belong to the verify aggregate; `TaskSubtreeRepository`
 * removes them in the same transaction.
 */
export const deleteTasksByIds = async (
  ctx: TaskModelContext,
  taskIds: string[],
): Promise<number> => {
  if (taskIds.length === 0) return 0;

  const result = await ctx.db
    .delete(tasks)
    .where(and(inArray(tasks.id, taskIds), taskOwnership(ctx)))
    .returning({ id: tasks.id });

  return result.length;
};
