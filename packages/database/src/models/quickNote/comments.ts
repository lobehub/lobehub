import { and, eq, inArray } from 'drizzle-orm';

import { quickNoteComments, quickNotes } from '../../schemas';
import { ownedQuickNoteIds, type QuickNoteContext, quickNoteOwnershipWhere } from './context';
import type { CreateQuickNoteCommentParams, UpdateQuickNoteCommentParams } from './types';

export const createComment = async (
  ctx: QuickNoteContext,
  quickNoteId: string,
  params: CreateQuickNoteCommentParams,
) => {
  const [quickNote] = await ctx.db
    .select({ id: quickNotes.id })
    .from(quickNotes)
    .where(and(eq(quickNotes.id, quickNoteId), quickNoteOwnershipWhere(ctx)));
  if (!quickNote) return undefined;

  const [comment] = await ctx.db
    .insert(quickNoteComments)
    .values({
      authorUserId: ctx.userId,
      content: params.content,
      editorData: params.editorData,
      quickNoteId,
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    })
    .returning();

  return comment;
};

export const queryComments = async (ctx: QuickNoteContext, quickNoteId: string) =>
  ctx.db
    .select({
      authorUserId: quickNoteComments.authorUserId,
      content: quickNoteComments.content,
      createdAt: quickNoteComments.createdAt,
      editorData: quickNoteComments.editorData,
      id: quickNoteComments.id,
      updatedAt: quickNoteComments.updatedAt,
    })
    .from(quickNoteComments)
    .innerJoin(quickNotes, eq(quickNotes.id, quickNoteComments.quickNoteId))
    .where(and(eq(quickNoteComments.quickNoteId, quickNoteId), quickNoteOwnershipWhere(ctx)))
    .orderBy(quickNoteComments.createdAt, quickNoteComments.id);

/** Overwrites an owned Comment's content; Runs keep the text they saw in their input snapshot. */
export const updateComment = async (
  ctx: QuickNoteContext,
  commentId: string,
  params: UpdateQuickNoteCommentParams,
) => {
  const [comment] = await ctx.db
    .update(quickNoteComments)
    .set({ content: params.content, editorData: params.editorData, updatedAt: new Date() })
    .where(
      and(
        eq(quickNoteComments.id, commentId),
        inArray(quickNoteComments.quickNoteId, ownedQuickNoteIds(ctx)),
      ),
    )
    .returning();

  return comment;
};
