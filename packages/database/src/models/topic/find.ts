import type { TopicRankItem } from '@lobechat/types';
import {
  and,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  ne,
  not,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';

import {
  agentOperations,
  agents,
  messages,
  topicDocuments,
  type TopicItem,
  topics,
} from '../../schemas';
import { sanitizeBm25Query } from '../../utils/bm25';
import { genEndDateWhere, genRangeWhere, genStartDateWhere, genWhere } from '../../utils/genWhere';
import { inJsonStringArray } from '../../utils/inJsonStringArray';
import { searchableMessage } from '../../utils/searchableMessage';
import { notChannelTopic } from '../../utils/topicVisibility';
import { nonNull } from '../utils/rows';
import type { TopicModelContext } from './context';
import type { TopicKeywordScope } from './types';

/**
 * Ownership-scoped lookup. Agent-share visitor topics carry the CREATOR's
 * `userId` and are excluded by default; the share runtime opts in by
 * constructing the model with `{ includeShareVisitor: true }`.
 * `findVisitorTopicOrThrow` in `apps/server/src/routers/lambda/shareChat.ts`
 * relies on that opt-in and then verifies `senderId` itself.
 */
export const findById = async (ctx: TopicModelContext, id: string) => {
  return ctx.db.query.topics.findFirst({
    where: and(eq(topics.id, id), ctx.ownership()),
  });
};

/**
 * Kept for readability at creator-facing router call sites; the default
 * scope already excludes agent-share visitor topics, so this is a thin
 * alias of {@link TopicModel.findById}.
 */
export const findOwnTopicById = async (ctx: TopicModelContext, id: string) => {
  return findById(ctx, id);
};

/**
 * Ids among `ids` that resolve to an agent-share VISITOR topic under this
 * owner — the inverse of {@link notShareVisitorTopic}, the predicate every
 * creator-facing read applies.
 *
 * Creator-facing write entry points use this to reject visitor targets
 * (see `assertCreatorTopicTargets` in the server router helpers). Ids that
 * match no row at all are NOT reported, so callers keep their existing no-op
 * behaviour for stale/foreign ids.
 */
export const findShareVisitorTopicIds = async (
  ctx: TopicModelContext,
  ids: string[],
): Promise<string[]> => {
  if (ids.length === 0) return [];

  const rows = await ctx.db
    .select({ id: topics.id })
    .from(topics)
    // Explicitly scoped visitor-inclusive: this method's whole job is to
    // return visitor ids so the router-level `assertCreatorTopicTargets`
    // can reject them, so it must bypass the instance's visitor exclusion.
    .where(and(inArray(topics.id, ids), ctx.workspaceScope(), isNotNull(topics.senderId)));

  return rows.map((row) => row.id);
};

export const findByIds = async (ctx: TopicModelContext, ids: string[]): Promise<TopicItem[]> => {
  if (ids.length === 0) return [];
  return ctx.db.query.topics.findMany({
    where: and(inArray(topics.id, ids), ctx.ownership()),
  });
};

/**
 * Kept for readability at creator-facing router call sites; the default
 * scope already excludes agent-share visitor topics, so this is a thin
 * alias of {@link TopicModel.findByIds}.
 */
export const findOwnTopicsByIds = async (
  ctx: TopicModelContext,
  ids: string[],
): Promise<TopicItem[]> => {
  return findByIds(ctx, ids);
};

/**
 * Minimal creator projection for router-level workspace row checks on
 * batch-by-ids operations (batch delete / move).
 */
export const findOwnersByIds = async (
  ctx: TopicModelContext,
  ids: string[],
): Promise<{ id: string; userId: string }[]> => {
  if (ids.length === 0) return [];

  return ctx.db
    .select({ id: topics.id, userId: topics.userId })
    .from(topics)
    .where(and(inArray(topics.id, ids), ctx.ownership()));
};

/**
 * Find the unique topic an agent shares with a document for a given trigger
 * (e.g. the doc-anchored chat topic provisioned by
 * `agentDocument.getOrCreateChatTopic`). Joins through `topic_documents`.
 */
export const findByAgentAndDocumentTrigger = async (
  ctx: TopicModelContext,
  params: {
    agentId: string;
    documentId: string;
    trigger: string;
  },
): Promise<TopicItem | undefined> => {
  const result = await ctx.db
    .select({ topic: topics })
    .from(topics)
    .innerJoin(topicDocuments, eq(topicDocuments.topicId, topics.id))
    .where(
      and(
        ctx.ownership(),
        eq(topics.agentId, params.agentId),
        eq(topics.trigger, params.trigger),
        eq(topicDocuments.documentId, params.documentId),
      ),
    )
    .limit(1);

  return result[0]?.topic;
};

/**
 * Who started each topic's current run. Workspace topics are co-editable, so
 * the member running a topic now can differ from its creator (`topics.userId`);
 * the latest top-level running operation records the actual initiator — the
 * same row `runStartedAt` reads. Topics whose run never wrote an operation
 * row (client-executed runs) are absent; callers fall back to the creator.
 *
 * Not scoped by {@link ownership}: in a workspace the run may belong to
 * another member, and callers pass ids from an ownership-gated topic read.
 */
export const findRunInitiators = async (
  ctx: TopicModelContext,
  topicIds: string[],
): Promise<Map<string, string>> => {
  if (topicIds.length === 0) return new Map();

  const rows = await ctx.db
    .selectDistinctOn([agentOperations.topicId], {
      topicId: agentOperations.topicId,
      userId: agentOperations.userId,
    })
    .from(agentOperations)
    .where(
      and(
        inArray(agentOperations.topicId, topicIds),
        eq(agentOperations.status, 'running'),
        isNull(agentOperations.parentOperationId),
        isNotNull(agentOperations.startedAt),
      ),
    )
    .orderBy(agentOperations.topicId, desc(agentOperations.startedAt));

  // `inArray(agentOperations.topicId, …)` never matches a NULL topic_id.
  return new Map(
    rows.map((row) => [nonNull(row.topicId, 'agent_operations.topic_id'), row.userId]),
  );
};

/**
 * Recent topics from the same IM channel, most-recent first. Matches the
 * channel via the `metadata.bot.platformThreadId` path written at topic
 * creation (see `ChatTopicBotContext`). Used to pre-inject cross-session
 * history on platforms that can't read chat history at runtime (e.g. WeChat,
 * whose `readMessages` throws), so a fresh topic still knows what the channel
 * was just talking about.
 */
export const findRecentByBotThread = async (
  ctx: TopicModelContext,
  platformThreadId: string,
  { limit = 3 }: { limit?: number } = {},
): Promise<TopicItem[]> => {
  if (!platformThreadId) return [];

  return ctx.db
    .select()
    .from(topics)
    .where(
      and(
        ctx.ownership(),
        sql`${topics.metadata} -> 'bot' ->> 'platformThreadId' = ${platformThreadId}`,
      ),
    )
    .orderBy(desc(topics.updatedAt))
    .limit(limit);
};

export const queryByKeyword = async (
  ctx: TopicModelContext,
  keyword: string,
  scope?: string | null | TopicKeywordScope,
  { onlyMine }: { onlyMine?: boolean } = {},
): Promise<TopicItem[]> => {
  if (!keyword.trim()) return [];

  // Mirrors the list's workspace "only mine" filter, so a search never brings
  // back the other members' topics the list is hiding.
  const onlyMineCondition = onlyMine ? eq(topics.userId, ctx.userId) : undefined;

  // Backward compatibility: a bare string / null second argument is treated
  // as the legacy `containerId` (sessionId or groupId).
  const scopeOptions: TopicKeywordScope =
    scope && typeof scope === 'object' ? scope : { containerId: scope ?? null };
  const scopeCondition = ctx.matchKeywordScope(scopeOptions);

  const bm25Query = sanitizeBm25Query(keyword);
  const candidateResults = ctx.ftsSearchCandidateSource?.ftsSearchCandidateEnabled
    ? await Promise.all([
        ctx.ftsSearchCandidateSource.ftsSearchCandidates({
          entity: 'topics',
          filters: { topicScope: scopeOptions },
          pagination: {},
          query: { fields: ['title'], text: keyword },
        }),
        ctx.ftsSearchCandidateSource.ftsSearchCandidates({
          entity: 'messages',
          filters: { topicScope: scopeOptions },
          pagination: {},
          query: { fields: ['content'], text: keyword },
        }),
      ])
    : undefined;
  const topicCandidateIds = candidateResults?.[0].candidates.map(({ id }) => id);
  const messageCandidateIds = candidateResults?.[1].candidates.map(({ id }) => id);

  // Run title and message content searches in parallel
  const [topicsByTitle, topicIdsByMessages] = await Promise.all([
    // Query topics matching by title (BM25)
    ctx.db
      .select()
      .from(topics)
      .where(
        and(
          ctx.ownership(),
          ctx.notShareVisitor(),
          notChannelTopic(),
          scopeCondition,
          onlyMineCondition,
          topicCandidateIds
            ? inJsonStringArray(topics.id, topicCandidateIds)
            : sql`${topics.title} @@@ ${bm25Query}`,
        ),
      )
      .orderBy(desc(topics.updatedAt)),
    // Query topic IDs matching by message content (BM25)
    ctx.db
      .select({ topicId: messages.topicId })
      .from(messages)
      .innerJoin(topics, eq(messages.topicId, topics.id))
      .where(
        and(
          ctx.messageOwnership(),
          searchableMessage(),
          messageCandidateIds
            ? inJsonStringArray(messages.id, messageCandidateIds)
            : sql`${messages.content} @@@ ${bm25Query}`,
          ctx.ownership(),
          ctx.notShareVisitor(),
          notChannelTopic(),
          scopeCondition,
          onlyMineCondition,
        ),
      )
      .groupBy(messages.topicId),
  ]);
  // If no topics found by message content, return topics matching by title
  if (topicIdsByMessages.length === 0) {
    return topicsByTitle;
  }

  // Query topics found by message content
  const topicIds = topicIdsByMessages
    .map((t) => t.topicId)
    .filter((id): id is string => id !== null);

  const topicsByMessages = await ctx.db.query.topics.findMany({
    orderBy: [desc(topics.updatedAt)],
    where: and(ctx.ownership(), inArray(topics.id, topicIds)),
  });

  // Merge results and deduplicate
  const allTopics = [...topicsByTitle];
  const existingIds = new Set(topicsByTitle.map((t) => t.id));

  for (const topic of topicsByMessages) {
    if (!existingIds.has(topic.id)) {
      allTopics.push(topic);
    }
  }

  // Sort by update time
  return allTopics.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
};

export const countTopics = async (
  ctx: TopicModelContext,
  params?: {
    agentId?: string;
    containerId?: string | null;
    endDate?: string;
    range?: [string, string];
    startDate?: string;
  },
): Promise<number> => {
  // Build agent-specific condition if agentId is provided
  const agentCondition: SQL | undefined = params?.agentId
    ? eq(topics.agentId, params.agentId)
    : undefined;

  const result = await ctx.db
    .select({
      count: count(topics.id),
    })
    .from(topics)
    .where(
      genWhere([
        ctx.ownership(),
        ctx.notShareVisitor(),
        notChannelTopic(),
        agentCondition,
        params?.containerId ? ctx.matchContainer(params.containerId) : undefined,
        params?.range
          ? genRangeWhere(params.range, topics.createdAt, (date) => date.toDate())
          : undefined,
        params?.endDate
          ? genEndDateWhere(params.endDate, topics.createdAt, (date) => date.toDate())
          : undefined,
        params?.startDate
          ? genStartDateWhere(params.startDate, topics.createdAt, (date) => date.toDate())
          : undefined,
      ]),
    );

  return result[0].count;
};

export const rank = async (
  ctx: TopicModelContext,
  limit: number = 10,
): Promise<TopicRankItem[]> => {
  return ctx.db
    .select({
      agentId: topics.agentId,
      count: count(messages.id).as('count'),
      id: topics.id,
      title: topics.title,
    })
    .from(topics)
    .where(and(ctx.ownership(), ctx.notShareVisitor(), notChannelTopic()))
    .leftJoin(messages, eq(topics.id, messages.topicId))
    .groupBy(topics.id)
    .orderBy(desc(sql`count`))
    .having(({ count }) => gt(count, 0))
    .limit(limit);
};

/**
 * Query recent topics for homepage display.
 * Returns basic topic info with agentId/groupId for later resolution.
 * - For agent topics: excludes virtual agents (except inbox)
 * - For group topics: includes topics with groupId
 * - For inbox: includes topics with slug='inbox'
 */
export const queryRecent = async (ctx: TopicModelContext, limit: number = 12) => {
  const latestMessageAtSubquery = ctx.db
    .select({ value: messages.updatedAt })
    .from(messages)
    .where(and(eq(messages.topicId, topics.id), ctx.messageOwnership()))
    .orderBy(desc(messages.updatedAt))
    .limit(1);
  const topicActivityAt =
    sql<Date>`COALESCE((${latestMessageAtSubquery}), ${topics.updatedAt})`.mapWith(
      topics.updatedAt,
    );

  const result = await ctx.db
    .select({
      agentId: topics.agentId,
      groupId: topics.groupId,
      id: topics.id,
      sessionId: topics.sessionId,
      title: topics.title,
      updatedAt: topicActivityAt,
    })
    .from(topics)
    .leftJoin(agents, eq(topics.agentId, agents.id))
    .where(
      and(
        ctx.ownership(),
        ctx.notShareVisitor(),
        notChannelTopic(),
        or(
          // Group topics: has groupId
          not(isNull(topics.groupId)),
          // Inbox agent topics
          eq(agents.slug, 'inbox'),
          // Agent topics: exclude virtual agents
          and(isNull(topics.groupId), ne(agents.virtual, true)),
        ),
      ),
    )
    .orderBy(desc(topicActivityAt))
    .limit(limit);

  return result.map((item) => ({
    ...item,
    type: item.groupId ? ('group' as const) : ('agent' as const),
    /* v8 ignore start -- unreachable: the `new Date(…)` arm; `mapWith(topics.updatedAt)` decodes the timestamptz cell into a Date, whichever driver returns it */
    updatedAt: item.updatedAt instanceof Date ? item.updatedAt : new Date(item.updatedAt),
    /* v8 ignore stop */
  }));
};

export const getCronTopicsGroupedByCronJob = async (
  ctx: TopicModelContext,
  agentId: string,
): Promise<{ cronJobId: string; topics: TopicItem[] }[]> => {
  const rows = await ctx.db
    .select()
    .from(topics)
    .where(
      and(
        ctx.ownership(),
        eq(topics.agentId, agentId),
        eq(topics.trigger, 'cron'),
        sql`COALESCE(${topics.metadata}->>'cronJobId', '') <> ''`,
      ),
    )
    .orderBy(desc(topics.createdAt));

  const grouped = new Map<string, TopicItem[]>();
  for (const topic of rows) {
    const cronJobId = (topic.metadata as { cronJobId?: string } | null)?.cronJobId;
    if (!cronJobId) continue;
    const group = grouped.get(cronJobId) ?? [];
    group.push(topic);
    grouped.set(cronJobId, group);
  }

  return [...grouped.entries()].map(([cronJobId, topicList]) => ({
    cronJobId,
    topics: topicList,
  }));
};
