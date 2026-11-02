import { and, eq, isNull } from 'drizzle-orm';

import { quickNotes, topics } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { notShareVisitorTopic } from '../../utils/shareVisitor';
import { buildWorkspaceWhere } from '../../utils/workspace';

/** The caller identity every `QuickNoteModel` query is scoped by. */
export interface QuickNoteContext {
  db: LobeChatDatabase;
  userId: string;
  workspaceId?: string;
}

/** The parameters of a module function after its leading `ctx`, for the model's delegators. */
export type QuickNoteArgs<F> = F extends (ctx: QuickNoteContext, ...args: infer A) => unknown
  ? A
  : never;

/** Subquery of the caller's Quick Note ids, for scoping writes to child rows. */
export const ownedQuickNoteIds = (ctx: QuickNoteContext) =>
  ctx.db.select({ id: quickNotes.id }).from(quickNotes).where(quickNoteOwnershipWhere(ctx));

/** Confines a query to the caller's own Quick Notes in the active scope (personal or workspace). */
export const quickNoteOwnershipWhere = (ctx: QuickNoteContext) =>
  and(
    eq(quickNotes.userId, ctx.userId),
    ctx.workspaceId ? eq(quickNotes.workspaceId, ctx.workspaceId) : isNull(quickNotes.workspaceId),
  )!;

/**
 * Topics a Quick Note may read or link as context: the caller's own conversations in the active
 * scope, never another workspace member's and never an Agent Share visitor's.
 *
 * Use when:
 * - Authorizing a Topic/conversation resource link, or choosing Topics for Analyze context.
 *
 * Expects:
 * - `topics` carries no per-row visibility; a workspace Topic's privacy follows its Agent/Group,
 *   so a member's Topic is pinned to its creator rather than shared with every member.
 */
export const quickNoteTopicAccessWhere = (ctx: { userId: string; workspaceId?: string }) =>
  and(
    buildWorkspaceWhere({ userId: ctx.userId, workspaceId: ctx.workspaceId }, topics),
    eq(topics.userId, ctx.userId),
    // Visitor Topics carry the creator's user and workspace ids but are not the creator's context.
    notShareVisitorTopic(),
  )!;
