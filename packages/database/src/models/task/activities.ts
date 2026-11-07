import { and, desc, eq, inArray } from 'drizzle-orm';

import type { NewTaskActivity, TaskActivityItem } from '../../schemas/task';
import { taskActivities, tasks } from '../../schemas/task';
import {
  activitiesOwnership,
  getTaskVisibility,
  type TaskModelContext,
  taskOwnership,
} from './context';

/**
 * Append one event row. Mirrors the parent task's visibility onto the row so
 * subsequent reads can be filtered without a JOIN — same contract as
 * `addComment`.
 */
export const addActivity = async (
  ctx: TaskModelContext,
  data: Omit<NewTaskActivity, 'id' | 'userId' | 'workspaceId' | 'visibility'>,
): Promise<TaskActivityItem> => {
  const visibility = await getTaskVisibility(ctx, data.taskId);
  const [activity] = await ctx.db
    .insert(taskActivities)
    .values({
      ...data,
      userId: ctx.userId,
      visibility,
      workspaceId: ctx.workspaceId ?? null,
    })
    .returning();
  return activity;
};

/**
 * Append several event rows in one INSERT. Unlike `addActivity`, the caller
 * supplies each row's visibility — meant for a bulk write that has already
 * read (and locked) the tasks it describes.
 */
export const addActivities = async (
  ctx: TaskModelContext,
  rows: Omit<NewTaskActivity, 'id' | 'userId' | 'workspaceId'>[],
): Promise<TaskActivityItem[]> => {
  if (rows.length === 0) return [];
  return ctx.db
    .insert(taskActivities)
    .values(
      rows.map((row) => ({ ...row, userId: ctx.userId, workspaceId: ctx.workspaceId ?? null })),
    )
    .returning();
};

/**
 * Lock a set of tasks for the rest of the transaction and return what a
 * bulk status write needs to describe them afterwards: the status each one
 * is leaving and the visibility its activity row inherits. Reading these
 * before the lock would let a concurrent edit slip in between and the log
 * would name a transition that never happened.
 */
export const lockForStatusChange = async (
  ctx: TaskModelContext,
  ids: string[],
): Promise<{ id: string; status: string; visibility: 'private' | 'public' }[]> => {
  if (ids.length === 0) return [];
  return ctx.db
    .select({ id: tasks.id, status: tasks.status, visibility: tasks.visibility })
    .from(tasks)
    .where(and(inArray(tasks.id, ids), taskOwnership(ctx)))
    .for('update');
};

/**
 * Oldest-first. `limit` keeps the newest N rows (still returned
 * oldest-first) so a long-lived task does not ship its whole history on
 * every detail poll; the table itself is the full audit trail.
 */
export const getActivities = async (
  ctx: TaskModelContext,
  taskId: string,
  limit?: number,
): Promise<TaskActivityItem[]> => {
  const where = and(eq(taskActivities.taskId, taskId), activitiesOwnership(ctx));
  if (limit === undefined) {
    return ctx.db.select().from(taskActivities).where(where).orderBy(taskActivities.createdAt);
  }
  const newest = await ctx.db
    .select()
    .from(taskActivities)
    .where(where)
    .orderBy(desc(taskActivities.createdAt), desc(taskActivities.id))
    .limit(limit);
  return newest.reverse();
};
