import { and, eq, inArray } from 'drizzle-orm';

import { topics } from '../../schemas';
import type { TopicModelContext } from './context';

/**
 * Delete one topic, cascading to the messages associated with it.
 *
 * Agent-share visitor topics carry the creator's `userId`, so ownership alone
 * would let the creator-facing `topic.removeTopic` destroy a visitor
 * conversation from a raw topic id (obtainable out of band, e.g. through data
 * export). Excluded here for the same reason the bulk sweeps exclude them —
 * see {@link deleteAll}.
 */
export const deleteTopic = async (ctx: TopicModelContext, id: string) => {
  return ctx.db
    .delete(topics)
    .where(and(eq(topics.id, id), ctx.ownership(), ctx.notShareVisitor()));
};

/**
 * Deletes multiple topics based on the sessionId.
 * `restrictToCreator` limits the sweep to the caller's own rows (workspace
 * non-owner members must not clear teammates' topics).
 *
 * Visitor topics have no sessionId, so the null-session (inbox) branch would
 * otherwise sweep them in — see {@link deleteAll} for why bulk sweeps exclude
 * them.
 */
export const batchDeleteBySessionId = async (
  ctx: TopicModelContext,
  sessionId?: string | null,
  options?: { restrictToCreator?: boolean },
) => {
  return ctx.db
    .delete(topics)
    .where(
      and(
        ctx.matchSession(sessionId),
        options?.restrictToCreator ? ctx.mine() : ctx.ownership(),
        ctx.notShareVisitor(),
      ),
    );
};

/**
 * Deletes multiple topics based on the groupId.
 * `restrictToCreator` limits the sweep to the caller's own rows in workspace mode.
 *
 * Visitor topics have no groupId, so the null-group branch would otherwise
 * sweep them in — see {@link deleteAll}.
 */
export const batchDeleteByGroupId = async (
  ctx: TopicModelContext,
  groupId?: string | null,
  options?: { restrictToCreator?: boolean },
) => {
  return ctx.db
    .delete(topics)
    .where(
      and(
        ctx.matchGroup(groupId),
        options?.restrictToCreator ? ctx.mine() : ctx.ownership(),
        ctx.notShareVisitor(),
      ),
    );
};

/**
 * Deletes all topics matching the given agentId (`topics.agentId`).
 * `restrictToCreator` limits the sweep to the caller's own rows (workspace
 * non-owner members must not clear teammates' topics).
 *
 * This is the creator's "clear this agent's topics" action, so agent-share
 * visitor topics are excluded (see {@link deleteAll}). Deleting the agent
 * itself is a different path: `topics.agent_id` cascades at the DB level, so
 * visitor topics do go away with the agent without any call to this method.
 */
export const batchDeleteByAgentId = async (
  ctx: TopicModelContext,
  agentId: string,
  options?: { restrictToCreator?: boolean },
) => {
  return ctx.db
    .delete(topics)
    .where(
      and(
        options?.restrictToCreator ? ctx.mine() : ctx.ownership(),
        eq(topics.agentId, agentId),
        ctx.notShareVisitor(),
      ),
    );
};

/**
 * Deletes multiple topics and all messages associated with them in a transaction.
 *
 * Agent-share visitor topics are excluded — see {@link TopicModel.delete}.
 */
export const batchDelete = async (ctx: TopicModelContext, ids: string[]) => {
  return ctx.db
    .delete(topics)
    .where(and(inArray(topics.id, ids), ctx.ownership(), ctx.notShareVisitor()));
};

/**
 * Hard delete by id that also reaches rows already in the recycle bin —
 * same ownership + share-visitor guards as {@link batchDelete}, scoped with
 * {@link trashScope} (`includeTrashed`) instead of {@link ownership}. For
 * cascade paths that own their id list: a linked topic sitting in the
 * recycle bin must not survive its parent's deletion and resurrect as a
 * sidebar orphan when the user later restores it.
 */
export const batchDeleteIncludingTrashed = async (ctx: TopicModelContext, ids: string[]) => {
  return ctx.db.delete(topics).where(and(inArray(topics.id, ids), ctx.trashScope()));
};

/**
 * Creator-facing "clear all my topics".
 *
 * Agent-share visitor topics live under the creator's `userId` but are hidden
 * from every creator-facing listing (see `notShareVisitorTopic` in
 * `../utils/shareVisitor`), so a sweep the creator cannot see the contents of
 * must not destroy them — "clear all" can only mean the rows the creator sees.
 * The same rule applies to the other id-less sweeps here.
 *
 * Id-targeted deletes ({@link TopicModel.delete}, {@link TopicModel.batchDelete})
 * apply the same guard: a creator can obtain a visitor topic id out of band
 * (data export), so naming the id is not proof the row is theirs to delete.
 */
export const deleteAll = async (ctx: TopicModelContext) => {
  return ctx.db.delete(topics).where(and(ctx.mine(), ctx.notShareVisitor()));
};
