import { and, eq, inArray } from 'drizzle-orm';

import type { NewTaskComment, TaskCommentItem } from '../../schemas/task';
import { taskComments } from '../../schemas/task';
import { commentsOwnership, getTaskVisibility, type TaskModelContext } from './context';

export class TaskCommentParentNotFoundError extends Error {
  constructor() {
    super('Parent comment not found');
    this.name = 'TaskCommentParentNotFoundError';
  }
}

/** Resolve every target before writing, including both visibility fences. */
const resolveCommentParents = async (
  ctx: TaskModelContext,
  taskId: string,
  parentIds: string[],
) => {
  const normalized = new Map<string, string>();
  if (parentIds.length === 0) return normalized;

  const parents = await ctx.db
    .select({ id: taskComments.id, parentCommentId: taskComments.parentCommentId })
    .from(taskComments)
    .where(
      and(
        inArray(taskComments.id, parentIds),
        eq(taskComments.taskId, taskId),
        commentsOwnership(ctx),
      ),
    );
  if (parents.length !== parentIds.length) throw new TaskCommentParentNotFoundError();

  const byId = new Map(parents.map((parent) => [parent.id, parent]));
  const rootIds = [
    ...new Set(
      parents.flatMap((parent) =>
        parent.parentCommentId === null || byId.has(parent.parentCommentId)
          ? []
          : [parent.parentCommentId],
      ),
    ),
  ];
  if (rootIds.length > 0) {
    const roots = await ctx.db
      .select({ id: taskComments.id, parentCommentId: taskComments.parentCommentId })
      .from(taskComments)
      .where(
        and(
          inArray(taskComments.id, rootIds),
          eq(taskComments.taskId, taskId),
          commentsOwnership(ctx),
        ),
      );
    for (const root of roots) byId.set(root.id, root);
  }
  for (const parent of parents) {
    const rootId = parent.parentCommentId ?? parent.id;
    const root = byId.get(rootId);
    if (!root || root.parentCommentId !== null) throw new TaskCommentParentNotFoundError();
    normalized.set(parent.id, rootId);
  }
  return normalized;
};

export const addComment = async (
  ctx: TaskModelContext,
  data: Omit<NewTaskComment, 'id'>,
): Promise<TaskCommentItem> => {
  // Mirror the parent task's visibility onto the comment so subsequent
  // reads/writes can be filtered without a JOIN. `getTaskVisibility` also
  // provides the final live-parent write fence.
  const visibility = await getTaskVisibility(ctx, data.taskId);
  const parentIds = data.parentCommentId == null ? [] : [data.parentCommentId];
  const parents = await resolveCommentParents(ctx, data.taskId, parentIds);
  const parentCommentId = data.parentCommentId == null ? null : parents.get(data.parentCommentId)!;
  const [comment] = await ctx.db
    .insert(taskComments)
    .values({ ...data, parentCommentId, visibility, workspaceId: ctx.workspaceId ?? null })
    .returning();
  return comment;
};

/** Rows per insert: well under Postgres' bind-parameter limit. */
const COMMENT_INSERT_CHUNK = 500;

/**
 * Add many comments to one task: its visibility is read once and the rows go
 * in as batched inserts, so a long imported history is a few round trips.
 */
export const addComments = async (
  ctx: TaskModelContext,
  taskId: string,
  rows: Omit<NewTaskComment, 'id' | 'taskId'>[],
): Promise<TaskCommentItem[]> => {
  if (rows.length === 0) return [];
  const visibility = await getTaskVisibility(ctx, taskId);
  const parentIds = [
    ...new Set(rows.flatMap((row) => (row.parentCommentId == null ? [] : [row.parentCommentId]))),
  ];
  const parents = await resolveCommentParents(ctx, taskId, parentIds);
  const added: TaskCommentItem[] = [];
  for (let start = 0; start < rows.length; start += COMMENT_INSERT_CHUNK) {
    added.push(
      ...(await ctx.db
        .insert(taskComments)
        .values(
          rows.slice(start, start + COMMENT_INSERT_CHUNK).map((row) => ({
            ...row,
            parentCommentId: row.parentCommentId == null ? null : parents.get(row.parentCommentId)!,
            taskId,
            visibility,
            workspaceId: ctx.workspaceId ?? null,
          })),
        )
        .returning()),
    );
  }
  return added;
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
