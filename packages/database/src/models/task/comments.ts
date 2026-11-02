import { and, eq } from 'drizzle-orm';

import type { NewTaskComment, TaskCommentItem } from '../../schemas/task';
import { taskComments } from '../../schemas/task';
import { commentsOwnership, getTaskVisibility, type TaskModelContext } from './context';

export const addComment = async (
  ctx: TaskModelContext,
  data: Omit<NewTaskComment, 'id'>,
): Promise<TaskCommentItem> => {
  // Mirror the parent task's visibility onto the comment so subsequent
  // reads/writes can be filtered without a JOIN. `getTaskVisibility` also
  // provides the final live-parent write fence.
  const visibility = await getTaskVisibility(ctx, data.taskId);
  const [comment] = await ctx.db
    .insert(taskComments)
    .values({ ...data, visibility, workspaceId: ctx.workspaceId ?? null })
    .returning();
  return comment;
};

export const findCommentById = async (
  ctx: TaskModelContext,
  id: string,
): Promise<TaskCommentItem | undefined> => {
  const [comment] = await ctx.db
    .select()
    .from(taskComments)
    .where(and(eq(taskComments.id, id), commentsOwnership(ctx)))
    .limit(1);
  return comment;
};

export const getComments = async (
  ctx: TaskModelContext,
  taskId: string,
): Promise<TaskCommentItem[]> => {
  return ctx.db
    .select()
    .from(taskComments)
    .where(and(eq(taskComments.taskId, taskId), commentsOwnership(ctx)))
    .orderBy(taskComments.createdAt);
};

export const deleteComment = async (ctx: TaskModelContext, id: string): Promise<boolean> => {
  const result = await ctx.db
    .delete(taskComments)
    .where(and(eq(taskComments.id, id), commentsOwnership(ctx)))
    .returning();
  return result.length > 0;
};

export const updateComment = async (
  ctx: TaskModelContext,
  id: string,
  content: string,
  opts?: { editorData?: unknown },
): Promise<TaskCommentItem | undefined> => {
  const [comment] = await ctx.db
    .update(taskComments)
    .set({
      content,
      ...(opts?.editorData !== undefined ? { editorData: opts.editorData as never } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(taskComments.id, id), commentsOwnership(ctx)))
    .returning();
  return comment;
};
