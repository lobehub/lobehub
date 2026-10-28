// Fixture: an imported parent helper whose body is not visible gates the insert; the row
// has no other caller-provided endpoint.
import { getTaskVisibility, type TaskModelContext } from './context';
import { type NewTaskActivity, taskActivities } from './schema';

/**
 * Append one event row. Mirrors the parent task's visibility onto the row so
 * subsequent reads can be filtered without a JOIN.
 */
export const addActivity = async (
  ctx: TaskModelContext,
  data: Omit<NewTaskActivity, 'id' | 'userId' | 'workspaceId' | 'visibility'>,
) => {
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
