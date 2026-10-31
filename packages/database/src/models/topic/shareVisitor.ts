import { AGENT_SHARE_VISITOR_TOPIC_LIST_LIMIT } from '@lobechat/const';
import type { ChatTopicMetadata } from '@lobechat/types';
import { and, count, countDistinct, desc, eq, isNotNull } from 'drizzle-orm';

import { topics } from '../../schemas';
import type { TopicModelContext } from './context';
import type { VisitorRunningOperation, VisitorTopicItem } from './types';

/**
 * Fallback page size for {@link TopicModel.queryBySender} when a caller
 * doesn't pass one. Pinned to the package default per-visitor topic cap.
 *
 * Callers with a live share config (e.g. `shareChat.getTopics`) MUST pass the
 * share's actual resolved `maxTopicsPerVisitor` as `pageSize` instead of
 * relying on this default — a creator who raises the cap above the default
 * would otherwise have a visitor's list silently truncated below what that
 * visitor is actually allowed to create.
 */
export const VISITOR_TOPIC_PAGE_SIZE = AGENT_SHARE_VISITOR_TOPIC_LIST_LIMIT;

/**
 * Projects `topics.metadata.runningOperation` down to the visitor-safe subset
 * — see {@link VisitorRunningOperation}. Used by {@link TopicModel.queryBySender}
 * so a share visitor's topic list can drive `useGatewayReconnect` without ever
 * receiving the rest of `metadata` (creator-only fields — see the module doc).
 */
export const pickVisitorRunningOperation = (
  metadata: ChatTopicMetadata | null | undefined,
): VisitorRunningOperation | null => {
  const runningOperation = metadata?.runningOperation;
  if (!runningOperation) return null;

  const { assistantMessageId, heteroType, operationId, scope, startedAt, threadId } =
    runningOperation;
  return { assistantMessageId, heteroType, operationId, scope, startedAt, threadId };
};

/**
 * Share-visitor topic list for one visitor on one shared agent. The model is
 * constructed with the CREATOR's userId (visitor topics carry it), so the
 * caller — the shareChat router — must have already authorized the visitor
 * via the share access check; `agentId` + `senderId` together are the
 * per-visitor boundary.
 *
 * `agent_shares` is 1:1 per agent (`agent_shares_agent_id_unique`), so
 * `agentId` alone identifies which share a visitor topic belongs to — there
 * is no `topics.share_id` column to scope by. Turning sharing off and back
 * on keeps the same row and the same `agentId`, so a returning visitor's
 * older conversations DO resurface under the republished share. That is the
 * accepted trade-off of not carrying a share id on the row.
 *
 * Selects a visitor-facing DTO instead of the full row: the visitor surface
 * only renders id/title/runningOperation, and the row also carries
 * creator-only fields (owning userId, model/provider snapshot, cost/usage,
 * internal status and the rest of `metadata`) that must never reach a share
 * visitor. `metadata` itself IS selected (needed to project
 * `runningOperation`), but only the sanitized projection — never the raw
 * column — leaves this method; see {@link VisitorRunningOperation}.
 */
export const queryBySender = async (
  ctx: TopicModelContext,
  { agentId, senderId }: { agentId: string; senderId: string },
  { pageSize = VISITOR_TOPIC_PAGE_SIZE }: { pageSize?: number } = {},
): Promise<VisitorTopicItem[]> => {
  const rows = await ctx.db
    .select({
      createdAt: topics.createdAt,
      id: topics.id,
      metadata: topics.metadata,
      title: topics.title,
      updatedAt: topics.updatedAt,
    })
    .from(topics)
    .where(and(ctx.mine(), eq(topics.agentId, agentId), eq(topics.senderId, senderId)))
    .orderBy(desc(topics.updatedAt))
    .limit(pageSize);

  return rows.map(({ metadata, ...rest }) => ({
    ...rest,
    runningOperation: pickVisitorRunningOperation(metadata),
  }));
};

/**
 * Per-visitor topic count on a shared agent — drives `maxTopicsPerVisitor`.
 * Same `(agentId, senderId)` scoping as {@link queryBySender}; see that
 * method's JSDoc for why there is no share-id dimension.
 */
export const countBySender = async (
  ctx: TopicModelContext,
  {
    agentId,
    senderId,
  }: {
    agentId: string;
    senderId: string;
  },
): Promise<number> => {
  const result = await ctx.db
    .select({ count: count(topics.id) })
    .from(topics)
    .where(and(ctx.mine(), eq(topics.agentId, agentId), eq(topics.senderId, senderId)));

  return result[0].count;
};

/**
 * Creator-facing roll-up for one shared agent: how many conversations
 * visitors started, and how many distinct visitors started them.
 *
 * Counterpart to {@link countBySender}, which counts ONE visitor. Both rely
 * on `senderId` being non-null only for share-originated topics, so the
 * creator's own conversations with the same agent are excluded. Scoped by
 * `ctx.mine()` like every other read here, so the numbers can only ever
 * describe rows the caller owns.
 *
 * `agentShares` is 1:1 per agent, so `agentId` alone is the share dimension
 * — see {@link queryBySender} for why a disable → re-enable cycle keeps
 * counting the earlier conversations.
 */
export const countShareVisitors = async (
  ctx: TopicModelContext,
  {
    agentId,
  }: {
    agentId: string;
  },
): Promise<{ topicCount: number; visitorCount: number }> => {
  const [result] = await ctx.db
    .select({
      topicCount: count(topics.id),
      visitorCount: countDistinct(topics.senderId),
    })
    .from(topics)
    .where(and(ctx.mine(), eq(topics.agentId, agentId), isNotNull(topics.senderId)));

  return {
    topicCount: Number(result?.topicCount ?? 0),
    visitorCount: Number(result?.visitorCount ?? 0),
  };
};
