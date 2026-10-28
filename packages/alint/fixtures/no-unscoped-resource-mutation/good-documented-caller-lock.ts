// Fixture: the doc comment states the caller has already read and locked the rows through
// a scoped method; that is a caller-authorization contract.
import { and, inArray } from 'drizzle-orm';

import { type TaskModelContext, taskOwnership } from './context';
import { type NewTaskActivity, taskActivities, tasks } from './schema';

/**
 * Append several event rows in one INSERT. Unlike `addActivity`, the caller
 * supplies each row's visibility — meant for a bulk write that has already
 * read (and locked) the tasks it describes through `lockForStatusChange`.
 */
export const addActivities = async (
  ctx: TaskModelContext,
  rows: Omit<NewTaskActivity, 'id' | 'userId' | 'workspaceId'>[],
) => {
  if (rows.length === 0) return [];
  return ctx.db
    .insert(taskActivities)
    .values(
      rows.map((row) => ({ ...row, userId: ctx.userId, workspaceId: ctx.workspaceId ?? null })),
    )
    .returning();
};

/** Lock a set of tasks for the rest of the transaction. */
export const lockForStatusChange = async (ctx: TaskModelContext, ids: string[]) => {
  if (ids.length === 0) return [];
  return ctx.db
    .select({ id: tasks.id, status: tasks.status, visibility: tasks.visibility })
    .from(tasks)
    .where(and(inArray(tasks.id, ids), taskOwnership(ctx)))
    .for('update');
};
