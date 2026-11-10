import type { TaskItem } from '@lobechat/types';
import { and, eq, inArray, or, type SQL } from 'drizzle-orm';

import { tasks } from '../../schemas/task';
import {
  isTrashed,
  restoreStamp,
  type SoftDeleteOptions,
  trashStamp,
} from '../../utils/softDelete';
import { buildWorkspaceWhere } from '../../utils/workspace';
import type { TaskModelContext } from './context';

/**
 * `taskOwnership` without the recycle-bin filter — the scope restore / purge
 * internals run in, so a trashed row is reachable. Visibility still applies:
 * a member can only bring back (or purge) a task they could see.
 */
export const taskTrashScope = (ctx: TaskModelContext): SQL =>
  buildWorkspaceWhere(
    { userId: ctx.userId, workspaceId: ctx.workspaceId },
    {
      userId: tasks.createdByUserId,
      visibility: tasks.visibility,
      workspaceId: tasks.workspaceId,
    },
  );

/**
 * Move tasks to the recycle bin with the same compare-and-set the hard delete
 * used: a row is stamped only while its status is still the one the caller
 * decided on, so a run that moved it on in the meantime wins. Rows already
 * trashed (or not visible) are left alone. Briefs, comments, dependencies and
 * documents are not stamped — they hide with the task and hard-cascade at
 * purge time. Subtasks are not cascaded: they stay live and list as top-level
 * rows until their parent comes back.
 */
export const softDeleteIfStatusForIds = async (
  ctx: TaskModelContext,
  expected: { id: string; status: string }[],
  options: SoftDeleteOptions,
): Promise<TaskItem[]> => {
  if (expected.length === 0) return [];
  const matches = expected.map(({ id, status }) => and(eq(tasks.id, id), eq(tasks.status, status)));
  return ctx.db
    .update(tasks)
    .set(trashStamp(options.deletedAt))
    .where(
      and(
        or(...matches),
        // With `isDeleted` the scope carries `is_deleted IS NOT TRUE`: only live rows.
        buildWorkspaceWhere(
          { userId: ctx.userId, workspaceId: ctx.workspaceId },
          {
            isDeleted: tasks.isDeleted,
            userId: tasks.createdByUserId,
            visibility: tasks.visibility,
            workspaceId: tasks.workspaceId,
          },
        ),
      ),
    )
    .returning();
};

/** Bring trashed tasks back. Only rows currently stamped are touched. */
export const restore = async (ctx: TaskModelContext, ids: string[]): Promise<TaskItem[]> => {
  if (ids.length === 0) return [];
  return ctx.db
    .update(tasks)
    .set(restoreStamp())
    .where(and(inArray(tasks.id, ids), taskTrashScope(ctx), isTrashed(tasks.isDeleted)))
    .returning();
};

/** Trashed rows by id, bypassing the recycle-bin filter (restore / purge internals). */
export const findTrashedByIds = async (
  ctx: TaskModelContext,
  ids: string[],
): Promise<TaskItem[]> => {
  if (ids.length === 0) return [];
  return ctx.db
    .select()
    .from(tasks)
    .where(and(inArray(tasks.id, ids), taskTrashScope(ctx), isTrashed(tasks.isDeleted)));
};

/** Of `ids`, the tasks sitting in the recycle bin (a subtask's restore checks its parent). */
export const findTrashedIds = async (ctx: TaskModelContext, ids: string[]): Promise<string[]> => {
  if (ids.length === 0) return [];
  const rows = await ctx.db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(inArray(tasks.id, ids), taskTrashScope(ctx), isTrashed(tasks.isDeleted)));
  return rows.map((row) => row.id);
};

/**
 * Hard delete for the purge sweep. Only rows still stamped: a restore that
 * commits first keeps its task. FK cascades take dependencies, comments,
 * briefs links and `task_topics`; subtasks keep living — the self FK is
 * `ON DELETE SET NULL`, the same outcome the hard delete always had.
 */
export const purge = async (ctx: TaskModelContext, ids: string[]): Promise<string[]> => {
  if (ids.length === 0) return [];
  const deleted = await ctx.db
    .delete(tasks)
    .where(and(inArray(tasks.id, ids), taskTrashScope(ctx), isTrashed(tasks.isDeleted)))
    .returning({ id: tasks.id });
  return deleted.map((row) => row.id);
};
