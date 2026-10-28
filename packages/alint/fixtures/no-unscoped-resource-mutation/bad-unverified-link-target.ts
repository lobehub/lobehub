// Fixture: the parent task is authorized through a helper, but the linked document id
// is never checked.
import { getTaskVisibility, type TaskModelContext } from './context';
import { taskDocuments } from './schema';

export const pinDocument = async (
  ctx: TaskModelContext,
  taskId: string,
  documentId: string,
  pinnedBy: string = 'agent',
): Promise<void> => {
  const visibility = await getTaskVisibility(ctx, taskId);
  await ctx.db
    .insert(taskDocuments)
    // alint-expect
    .values({
      documentId,
      pinnedBy,
      taskId,
      userId: ctx.userId,
      visibility,
      workspaceId: ctx.workspaceId ?? null,
    })
    .onConflictDoNothing();
};
