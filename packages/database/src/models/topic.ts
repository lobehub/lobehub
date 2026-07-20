import type {
  ChatTopicMetadata,
  ChatTopicStatus,
  DBMessageItem,
  TopicQuerySortBy,
  TopicRankItem,
  TopicScheduledRun,
} from '@lobechat/types';
import type { TimingSink } from '@lobechat/utils';
import {
  getDurationMs,
  logTimingSink as logTiming,
  runTimedSinkStage as runTimedStage,
} from '@lobechat/utils';
import type { SQL } from 'drizzle-orm';
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  gt,
  gte,
  inArray,
  isNull,
  lte,
  ne,
  not,
  or,
  sql,
} from 'drizzle-orm';

import type { TopicItem } from '../schemas';
import { agents, messagePlugins, messages, threads, topicDocuments, topics } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { sanitizeBm25Query } from '../utils/bm25';
import { genEndDateWhere, genRangeWhere, genStartDateWhere, genWhere } from '../utils/genWhere';
import { idGenerator } from '../utils/idGenerator';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';
import { recomputeTopicUsage } from './topicUsage';

type OnboardingSessionMetadataPatch = Partial<NonNullable<ChatTopicMetadata['onboardingSession']>>;
type TopicMetadataPatch = Omit<Partial<ChatTopicMetadata>, 'onboardingSession'> & {
  onboardingSession?: OnboardingSessionMetadataPatch;
};

/**
 * How much of the last assistant reply `queryTopics` ships to a list view. Long
 * enough that a run summary arrives whole, short enough that 200 rows of raw
 * markdown never do — anything past it is marked with an ellipsis, and the full
 * text is one click away in the topic itself.
 */
const LAST_MESSAGE_PREVIEW_LENGTH = 2000;

export interface TopicListItem extends TopicItem {
  /** The topic's last non-empty assistant reply, truncated with a trailing `…`. Only set when `queryTopics` is called with `withLastMessage`. */
  lastAssistantMessage?: string | null;
}

export interface CreateTopicParams {
  agentId?: string | null;
  favorite?: boolean;
  groupId?: string | null;
  messages?: string[];
  metadata?: ChatTopicMetadata;
  /** Pinned model snapshot, persisted to the top-level `topics.model` column. */
  model?: string | null;
  provider?: string | null;
  sessionId?: string | null;
  /**
   * Initial status. Defaults to the column default (`active`). A topic created
   * with `metadata.scheduledRun` must set `scheduled` here so the status and the
   * payload land in the same insert — the dispatcher treats the pair as one fact.
   */
  status?: ChatTopicStatus;
  title?: string;
  trigger?: string | null;
}

interface QueryTopicParams {
  agentId?: string | null;
  /**
   * @deprecated Use agentId or groupId instead. Kept for backward compatibility.
   * Container ID (sessionId or groupId) to filter topics by
   */
  containerId?: string | null;
  current?: number;
  /**
   * Exclude topics by status (e.g. ['completed'])
   */
  excludeStatuses?: string[];
  /**
   * Exclude topics by trigger types (e.g. ['cron'])
   * Ignored when includeTriggers is provided.
   */
  excludeTriggers?: string[];
  /**
   * Group ID to filter topics by
   */
  groupId?: string | null;
  /**
   * Include only topics whose trigger matches one of these values.
   * Takes precedence over excludeTriggers when provided.
   */
  includeTriggers?: string[];
  /**
   * Whether this is an inbox agent query.
   * When true, also includes legacy inbox topics (sessionId IS NULL AND groupId IS NULL AND agentId IS NULL)
   */
  isInbox?: boolean;
  pageSize?: number;
  /**
   * Server-side ordering. Defaults to `updatedAt`. `status` orders by status
   * priority (see `STATUS_SORT_RANK`) so the sidebar "group by status" mode
   * keeps high-priority topics on the first page.
   */
  sortBy?: TopicQuerySortBy;
  timing?: ModelTimingContext;
  /**
   * Include only topics matching the given trigger types (positive filter)
   */
  triggers?: string[];
  /**
   * When true, the SELECT also returns the heavier card-detail columns used
   * by the per-agent Topics management page: `firstUserMessage` (subquery),
   * `messageCount` (subquery), `description`, `trigger`. `cost` and
   * `tokenUsage` are intentionally omitted until a dedicated schema migration
   * adds real columns to back them. Defaults to false so sidebar paths stay
   * cheap.
   */
  withDetails?: boolean;
}

export interface ModelTimingContext extends TimingSink {}

/**
 * Scope used to constrain a keyword search to a single conversation owner.
 * Mirrors the precedence of {@link TopicModel.query}: groupId > agentId >
 * containerId (legacy sessionId / groupId).
 */
export interface TopicKeywordScope {
  agentId?: string | null;
  /**
   * @deprecated Use agentId or groupId instead. Only consulted when neither
   * agentId nor groupId is provided (legacy / mobile string-arg callers).
   * Container ID (sessionId or groupId) to filter topics by.
   */
  containerId?: string | null;
  groupId?: string | null;
}

export interface ListTopicsForMemoryExtractorCursor {
  createdAt: Date;
  id: string;
}

// Status priority for the sidebar "group by status" ordering. Lower rank =
// higher in the list. A NULL / unknown status falls through to `active` (3),
// matching the client which treats a missing status as active. Keep this in
// sync with `STATUS_GROUP_ORDER` / `resolveStatusBucket` in `@lobechat/utils`
// (client-side bucketing): `waitingForHuman`, `failed` and `unread` all collapse
// into the top `pending` bucket, so they must float to the top here too —
// otherwise such a topic could fall off the first page and vanish from the
// pending group.
const STATUS_SORT_RANK = sql`CASE ${topics.status}
  WHEN 'waitingForHuman' THEN 0
  WHEN 'failed' THEN 1
  WHEN 'unread' THEN 2
  WHEN 'running' THEN 3
  WHEN 'scheduled' THEN 4
  WHEN 'active' THEN 5
  WHEN 'paused' THEN 6
  WHEN 'completed' THEN 7
  WHEN 'archived' THEN 8
  ELSE 5 END`;

// Favorites always float to the top; the rest are ordered by the requested
// strategy. `status` adds the priority bucket before the recency tiebreaker.
const buildTopicOrderBy = (topicActivityAt: SQL, sortBy?: TopicQuerySortBy): SQL[] =>
  sortBy === 'status'
    ? [desc(topics.favorite), asc(STATUS_SORT_RANK), desc(topicActivityAt)]
    : [desc(topics.favorite), desc(topicActivityAt)];

/**
 * NEVER null-test a jsonb arrow / path expression inside a WHERE clause:
 *
 * ```sql
 * (metadata ->> 'cronJobId')          IS NULL          -- 💥
 * (metadata #>> '{a,b}')              IS NOT NULL      -- 💥
 * (metadata ->> 'status')             IS DISTINCT FROM 'done'  -- 💥
 * ```
 *
 * The engine backing production is not stock Postgres, and this query *shape*
 * crashes it outright — `rt_fetch used out-of-bounds`, SQLSTATE XX000, thrown
 * before any row is read (a table with zero matching rows crashes just the same,
 * so no test on real Postgres will ever catch it). Drizzle then reports it as a
 * bare `Failed query:`, with the real cause only in the driver's `[cause]`.
 *
 * COALESCE the extracted value to a sentinel instead — same semantics, a shape
 * the engine survives:
 *
 * ```sql
 * COALESCE(metadata ->> 'cronJobId', '') = ''                     -- "is null"
 * COALESCE((metadata #>> '{a,b}')::numeric, 0) <= $1              -- numeric gate
 * COALESCE(metadata ->> 'status', '') <> 'done'                   -- IS DISTINCT FROM
 * ```
 *
 * This has now bitten twice: `getLatestSpineMessageId` (LOBE-11376, #16693) and
 * `getDueScheduledTopics` (#17077 — the scheduled-run cron crashed on every tick
 * from the day it shipped, so rate-limit continuations never once resumed).
 */
export class TopicModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, topics);

  /**
   * In workspace mode `ownership()` matches every member's topics, so a bulk
   * "clear all" would wipe teammates' conversations. Destructive sweeps must
   * additionally pin `user_id` to the caller (personal mode is unchanged —
   * ownership already scopes to the user there).
   */
  private mine = () => and(this.ownership(), eq(topics.userId, this.userId));

  private messageOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, messages);
  // **************** Query *************** //

  query = async ({
    agentId,
    containerId,
    current = 0,
    excludeStatuses,
    excludeTriggers,
    includeTriggers,
    pageSize = 9999,
    groupId,
    isInbox,
    sortBy,
    timing,
    triggers,
    withDetails = false,
  }: QueryTopicParams = {}) => {
    const queryStartedAt = Date.now();
    logTiming(timing, 'db.topic.query:start', {
      current,
      hasAgentId: !!agentId,
      hasContainerId: !!containerId,
      hasGroupId: !!groupId,
      isInbox: !!isInbox,
      pageSize,
      withDetails,
    });
    const offset = current * pageSize;

    // Heavier columns gated behind `withDetails` and used by the per-agent
    // Topics management page: real aggregates from the `messages` table
    // (firstUserMessage + messageCount), plus the `description` / `trigger`
    // columns that sidebar paths don't consume. `cost` and `tokenUsage`
    // intentionally stay undefined here — they need their own schema
    // migration before they can be backed by real numbers.
    //
    // The two correlated subqueries are built with Drizzle's query builder
    // (not a raw `sql` template) so the inner `eq(messages.topicId,
    // topics.id)` renders as `"messages"."topic_id" = "topics"."id"` — both
    // sides fully qualified. A bare `sql\`... ${topics.id} ...\`` template
    // renders `topics.id` as an unqualified `"id"`, which PostgreSQL then
    // resolves against the inner FROM (messages.id) and the WHERE silently
    // matches nothing.
    const firstUserMessageSubquery = this.db
      .select({ value: messages.content })
      .from(messages)
      .where(and(eq(messages.topicId, topics.id), eq(messages.role, 'user')))
      .orderBy(asc(messages.createdAt))
      .limit(1);
    const messageCountSubquery = this.db
      .select({ value: sql<number>`count(*)::int` })
      .from(messages)
      .where(eq(messages.topicId, topics.id));
    const latestMessageAtSubquery = this.db
      .select({ value: messages.updatedAt })
      .from(messages)
      .where(and(eq(messages.topicId, topics.id), this.messageOwnership()))
      .orderBy(desc(messages.updatedAt))
      .limit(1);
    const topicActivityAt =
      sql<Date>`COALESCE((${latestMessageAtSubquery}), ${topics.updatedAt})`.mapWith(
        topics.updatedAt,
      );
    const orderBy = buildTopicOrderBy(topicActivityAt, sortBy);

    const detailColumns = withDetails
      ? {
          description: topics.description,
          firstUserMessage: sql<string | null>`(${firstUserMessageSubquery})`.as(
            'first_user_message',
          ),
          messageCount: sql<number>`(${messageCountSubquery})`.as('message_count'),
          trigger: topics.trigger,
        }
      : {};

    const includeTriggerCondition =
      includeTriggers && includeTriggers.length > 0
        ? inArray(topics.trigger, includeTriggers)
        : undefined;
    const excludeTriggerCondition = includeTriggerCondition
      ? undefined
      : excludeTriggers && excludeTriggers.length > 0
        ? or(isNull(topics.trigger), not(inArray(topics.trigger, excludeTriggers)))
        : undefined;
    const triggerCondition =
      triggers && triggers.length > 0 ? inArray(topics.trigger, triggers) : undefined;
    const excludeStatusCondition =
      excludeStatuses && excludeStatuses.length > 0
        ? or(
            isNull(topics.status),
            not(inArray(topics.status, excludeStatuses as ChatTopicStatus[])),
          )
        : undefined;

    // If groupId is provided, query topics by groupId directly
    if (groupId) {
      const whereCondition = and(
        this.ownership(),
        eq(topics.groupId, groupId),
        includeTriggerCondition,
        excludeTriggerCondition,
        triggerCondition,
        excludeStatusCondition,
      );

      const [items, totalResult] = await Promise.all([
        runTimedStage(
          timing,
          'db.topic.query.group.items.select',
          () =>
            this.db
              // Cast to `any` because Drizzle's `.select` infers a strict
              // SelectedFields shape and the conditional `detailColumns` widens
              // to a union; the runtime shape is correct and the client casts
              // back to `ChatTopic[]` after TRPC serialization.
              .select({
                completedAt: topics.completedAt,
                createdAt: topics.createdAt,
                favorite: topics.favorite,
                historySummary: topics.historySummary,
                id: topics.id,
                metadata: topics.metadata,
                model: topics.model,
                provider: topics.provider,
                status: topics.status,
                title: topics.title,
                updatedAt: topics.updatedAt,
                // Sidebar sorts/groups topics client-side by this `sortUpdatedAt` — the
                // same `topicActivityAt` the ORDER BY uses (latest message time, COALESCE
                // fallback to the row's own updatedAt). Keeping it separate from the
                // display `updatedAt` above matches the client-side sort key to the server
                // order (otherwise the two disagree and the list visibly jumps) while a
                // rename/favorite edit still shows its real edit time. See rankTopics for
                // the same activity-time pattern. (LOBE-11543)
                sortUpdatedAt: topicActivityAt,
                // Workspace sidebars filter maintenance actions client-side by
                // ownership (own vs workspace scope) — the filter needs the row
                // owner even in the slim projection.
                userId: topics.userId,
                ...detailColumns,
              } as any)
              .from(topics)
              .where(whereCondition)
              .orderBy(...orderBy)
              .limit(pageSize)
              .offset(offset),
          { current, pageSize },
        ),
        runTimedStage(timing, 'db.topic.query.group.count.select', () =>
          this.db
            .select({ count: count(topics.id) })
            .from(topics)
            .where(whereCondition),
        ),
      ]);

      logTiming(timing, 'db.topic.query:done', {
        itemCount: items.length,
        stageMs: getDurationMs(queryStartedAt),
        total: totalResult[0].count,
      });
      return { items, total: totalResult[0].count };
    }

    // If agentId is provided, match topics by `topics.agentId` directly. The
    // inbox agent additionally adopts very old orphan rows where every owner
    // column (session / group / agent) is null.
    if (agentId) {
      const agentCondition = isInbox
        ? or(
            eq(topics.agentId, agentId),
            and(isNull(topics.sessionId), isNull(topics.groupId), isNull(topics.agentId)),
          )
        : eq(topics.agentId, agentId);

      const agentWhere = and(
        this.ownership(),
        agentCondition,
        includeTriggerCondition,
        excludeTriggerCondition,
        triggerCondition,
        excludeStatusCondition,
      );

      const [items, totalResult] = await Promise.all([
        runTimedStage(
          timing,
          'db.topic.query.agent.items.select',
          () =>
            this.db
              // See note on the group-branch select above re: `as any` cast.
              .select({
                completedAt: topics.completedAt,
                createdAt: topics.createdAt,
                favorite: topics.favorite,
                historySummary: topics.historySummary,
                id: topics.id,
                metadata: topics.metadata,
                model: topics.model,
                provider: topics.provider,
                status: topics.status,
                title: topics.title,
                updatedAt: topics.updatedAt,
                // Sidebar sorts/groups topics client-side by this `sortUpdatedAt` — the
                // same `topicActivityAt` the ORDER BY uses (latest message time, COALESCE
                // fallback to the row's own updatedAt). Keeping it separate from the
                // display `updatedAt` above matches the client-side sort key to the server
                // order (otherwise the two disagree and the list visibly jumps) while a
                // rename/favorite edit still shows its real edit time. See rankTopics for
                // the same activity-time pattern. (LOBE-11543)
                sortUpdatedAt: topicActivityAt,
                // Workspace sidebars filter maintenance actions client-side by
                // ownership (own vs workspace scope) — the filter needs the row
                // owner even in the slim projection.
                userId: topics.userId,
                ...detailColumns,
              } as any)
              .from(topics)
              .where(agentWhere)
              .orderBy(...orderBy)
              .limit(pageSize)
              .offset(offset),
          { current, isInbox: !!isInbox, pageSize },
        ),
        runTimedStage(
          timing,
          'db.topic.query.agent.count.select',
          () =>
            this.db
              .select({ count: count(topics.id) })
              .from(topics)
              .where(agentWhere),
          { isInbox: !!isInbox },
        ),
      ]);

      logTiming(timing, 'db.topic.query:done', {
        itemCount: items.length,
        stageMs: getDurationMs(queryStartedAt),
        total: totalResult[0].count,
      });
      return { items, total: totalResult[0].count };
    }

    // Fallback to containerId-based query (backward compatibility)
    const whereCondition = and(
      this.ownership(),
      this.matchContainer(containerId),
      includeTriggerCondition,
      excludeTriggerCondition,
      triggerCondition,
      excludeStatusCondition,
    );

    const [items, totalResult] = await Promise.all([
      runTimedStage(
        timing,
        'db.topic.query.container.items.select',
        () =>
          this.db
            // See note on the group-branch select above re: `as any` cast.
            .select({
              agentId: topics.agentId,
              completedAt: topics.completedAt,
              createdAt: topics.createdAt,
              favorite: topics.favorite,
              historySummary: topics.historySummary,
              id: topics.id,
              metadata: topics.metadata,
              model: topics.model,
              provider: topics.provider,
              sessionId: topics.sessionId,
              status: topics.status,
              title: topics.title,
              updatedAt: topics.updatedAt,
              // Sidebar sorts/groups topics client-side by this `sortUpdatedAt` — the
              // same `topicActivityAt` the ORDER BY uses (latest message time, COALESCE
              // fallback to the row's own updatedAt). Keeping it separate from the
              // display `updatedAt` above matches the client-side sort key to the server
              // order (otherwise the two disagree and the list visibly jumps) while a
              // rename/favorite edit still shows its real edit time. See rankTopics for
              // the same activity-time pattern. (LOBE-11543)
              sortUpdatedAt: topicActivityAt,
              // Workspace sidebars filter maintenance actions client-side by
              // ownership (own vs workspace scope) — the filter needs the row
              // owner even in the slim projection.
              userId: topics.userId,
              ...detailColumns,
            } as any)
            .from(topics)
            .where(whereCondition)
            .orderBy(...orderBy)
            .limit(pageSize)
            .offset(offset),
        { current, pageSize },
      ),
      runTimedStage(timing, 'db.topic.query.container.count.select', () =>
        this.db
          .select({ count: count(topics.id) })
          .from(topics)
          .where(whereCondition),
      ),
    ]);

    // Remove internal fields before returning

    const cleanItems = items.map(({ agentId: _agentId, sessionId: _sessionId, ...rest }) => rest);

    logTiming(timing, 'db.topic.query:done', {
      itemCount: cleanItems.length,
      stageMs: getDurationMs(queryStartedAt),
      total: totalResult[0].count,
    });

    return { items: cleanItems, total: totalResult[0].count };
  };

  findById = async (id: string) => {
    return this.db.query.topics.findFirst({
      where: and(eq(topics.id, id), this.ownership()),
    });
  };

  /**
   * Minimal creator projection for router-level workspace row checks on
   * batch-by-ids operations (batch delete / move).
   */
  findOwnersByIds = async (ids: string[]): Promise<{ id: string; userId: string }[]> => {
    if (ids.length === 0) return [];

    return this.db
      .select({ id: topics.id, userId: topics.userId })
      .from(topics)
      .where(and(inArray(topics.id, ids), this.ownership()));
  };

  /**
   * Find the unique topic an agent shares with a document for a given trigger
   * (e.g. the doc-anchored chat topic provisioned by
   * `agentDocument.getOrCreateChatTopic`). Joins through `topic_documents`.
   */
  findByAgentAndDocumentTrigger = async (params: {
    agentId: string;
    documentId: string;
    trigger: string;
  }): Promise<TopicItem | undefined> => {
    const result = await this.db
      .select({ topic: topics })
      .from(topics)
      .innerJoin(topicDocuments, eq(topicDocuments.topicId, topics.id))
      .where(
        and(
          this.ownership(),
          eq(topics.agentId, params.agentId),
          eq(topics.trigger, params.trigger),
          eq(topicDocuments.documentId, params.documentId),
        ),
      )
      .limit(1);

    return result[0]?.topic;
  };

  /**
   * Query the current user's topics, optionally filtered by status — e.g. to
   * list actively-running topics across all agents without pulling the full
   * topic set to the client.
   *
   * `withLastMessage` additionally pulls each topic's last assistant reply, so a
   * list can show what the agent actually said instead of just a title. The
   * preview is truncated server-side — raw assistant output is unbounded
   * markdown, and a list only ever renders the head of it.
   */
  queryTopics = async ({
    statuses,
    pageSize = 200,
    withLastMessage,
  }: {
    pageSize?: number;
    statuses?: string[];
    withLastMessage?: boolean;
  } = {}): Promise<TopicListItem[]> => {
    const where = and(
      this.ownership(),
      statuses && statuses.length > 0
        ? inArray(topics.status, statuses as ChatTopicStatus[])
        : undefined,
    );

    if (!withLastMessage) {
      return this.db
        .select()
        .from(topics)
        .where(where)
        .orderBy(desc(topics.updatedAt))
        .limit(pageSize);
    }

    // Built with the query builder rather than a raw `sql` template so the inner
    // `eq(messages.topicId, topics.id)` renders both sides fully qualified —
    // see the note on `firstUserMessageSubquery` in `query()`.
    //
    // Assistant turns that only carried tool calls persist an empty `content`;
    // skipping them lands on the last thing the agent actually *said*.
    // One char past the limit, so the caller can tell "exactly this long" from
    // "cut short" and mark the cut instead of ending mid-sentence.
    const lastAssistantMessageSubquery = this.db
      .select({
        value: sql<string>`left(${messages.content}, ${LAST_MESSAGE_PREVIEW_LENGTH + 1})`,
      })
      .from(messages)
      .where(
        and(
          eq(messages.topicId, topics.id),
          eq(messages.role, 'assistant'),
          this.messageOwnership(),
          ne(messages.content, ''),
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(1);

    const rows = await this.db
      .select({
        ...getTableColumns(topics),
        lastAssistantMessage: sql<string | null>`(${lastAssistantMessageSubquery})`.as(
          'last_assistant_message',
        ),
      })
      .from(topics)
      .where(where)
      .orderBy(desc(topics.updatedAt))
      .limit(pageSize);

    return rows.map((row) => ({
      ...row,
      lastAssistantMessage:
        row.lastAssistantMessage && row.lastAssistantMessage.length > LAST_MESSAGE_PREVIEW_LENGTH
          ? `${row.lastAssistantMessage.slice(0, LAST_MESSAGE_PREVIEW_LENGTH)}…`
          : row.lastAssistantMessage,
    }));
  };

  queryByKeyword = async (
    keyword: string,
    scope?: string | null | TopicKeywordScope,
  ): Promise<TopicItem[]> => {
    if (!keyword.trim()) return [];

    // Backward compatibility: a bare string / null second argument is treated
    // as the legacy `containerId` (sessionId or groupId).
    const scopeOptions: TopicKeywordScope =
      scope && typeof scope === 'object' ? scope : { containerId: scope ?? null };
    const scopeCondition = this.matchKeywordScope(scopeOptions);

    const bm25Query = sanitizeBm25Query(keyword);

    // Run title and message content searches in parallel
    const [topicsByTitle, topicIdsByMessages] = await Promise.all([
      // Query topics matching by title (BM25)
      this.db
        .select()
        .from(topics)
        .where(and(this.ownership(), scopeCondition, sql`${topics.title} @@@ ${bm25Query}`))
        .orderBy(desc(topics.updatedAt)),
      // Query topic IDs matching by message content (BM25)
      this.db
        .select({ topicId: messages.topicId })
        .from(messages)
        .innerJoin(topics, eq(messages.topicId, topics.id))
        .where(
          and(
            this.messageOwnership(),
            sql`${messages.content} @@@ ${bm25Query}`,
            this.ownership(),
            scopeCondition,
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

    const topicsByMessages = await this.db.query.topics.findMany({
      orderBy: [desc(topics.updatedAt)],
      where: and(this.ownership(), inArray(topics.id, topicIds)),
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
  count = async (params?: {
    agentId?: string;
    containerId?: string | null;
    endDate?: string;
    range?: [string, string];
    startDate?: string;
  }): Promise<number> => {
    // Build agent-specific condition if agentId is provided
    const agentCondition: SQL | undefined = params?.agentId
      ? eq(topics.agentId, params.agentId)
      : undefined;

    const result = await this.db
      .select({
        count: count(topics.id),
      })
      .from(topics)
      .where(
        genWhere([
          this.ownership(),
          agentCondition,
          params?.containerId ? this.matchContainer(params.containerId) : undefined,
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

  rank = async (limit: number = 10): Promise<TopicRankItem[]> => {
    return this.db
      .select({
        agentId: topics.agentId,
        count: count(messages.id).as('count'),
        id: topics.id,
        title: topics.title,
      })
      .from(topics)
      .where(and(this.ownership()))
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
  queryRecent = async (limit: number = 12) => {
    const latestMessageAtSubquery = this.db
      .select({ value: messages.updatedAt })
      .from(messages)
      .where(and(eq(messages.topicId, topics.id), this.messageOwnership()))
      .orderBy(desc(messages.updatedAt))
      .limit(1);
    const topicActivityAt =
      sql<Date>`COALESCE((${latestMessageAtSubquery}), ${topics.updatedAt})`.mapWith(
        topics.updatedAt,
      );

    const result = await this.db
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
          this.ownership(),
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
      updatedAt: item.updatedAt instanceof Date ? item.updatedAt : new Date(item.updatedAt),
    }));
  };

  // **************** Create *************** //

  create = async (
    { messages: messageIds, ...params }: CreateTopicParams,
    id: string = this.genId(),
    timing?: ModelTimingContext,
  ): Promise<TopicItem> => {
    const insertData = buildWorkspacePayload(
      { userId: this.userId, workspaceId: this.workspaceId },
      {
        ...params,
        agentId: params.agentId || null,
        groupId: params.groupId || null,
        id,
        sessionId: params.sessionId || null,
      },
    );
    const insertMeta = {
      hasAgentId: !!params.agentId,
      hasGroupId: !!params.groupId,
      hasSessionId: !!params.sessionId,
    };

    if (!messageIds || messageIds.length === 0) {
      const [topic] = await runTimedStage(
        timing,
        'db.topic.create.topics.insert',
        () => this.db.insert(topics).values(insertData).returning(),
        insertMeta,
      );

      return topic;
    }

    return runTimedStage(
      timing,
      'db.topic.create.transaction',
      () =>
        this.db.transaction(async (tx) => {
          // Insert new topic
          const [topic] = await runTimedStage(
            timing,
            'db.topic.create.topics.insert',
            () => tx.insert(topics).values(insertData).returning(),
            insertMeta,
          );

          // Update associated messages' topicId
          await runTimedStage(
            timing,
            'db.topic.create.messages.updateTopic',
            () =>
              tx
                .update(messages)
                .set({ topicId: topic.id })
                .where(and(this.messageOwnership(), inArray(messages.id, messageIds))),
            { messageCount: messageIds.length },
          );

          return topic;
        }),
      {
        hasAgentId: !!params.agentId,
        hasGroupId: !!params.groupId,
        hasSessionId: !!params.sessionId,
        messageCount: messageIds?.length ?? 0,
      },
    );
  };

  batchCreate = async (topicParams: (CreateTopicParams & { id?: string })[]) => {
    // Start a transaction
    return this.db.transaction(async (tx) => {
      // Batch insert new topics into the topics table
      const createdTopics = await tx
        .insert(topics)
        .values(
          topicParams.map((params) =>
            buildWorkspacePayload(
              { userId: this.userId, workspaceId: this.workspaceId },
              {
                agentId: params.agentId || null,
                favorite: params.favorite,
                groupId: params.sessionId ? null : params.groupId,
                id: params.id || this.genId(),
                sessionId: params.groupId ? null : params.sessionId,
                title: params.title,
                trigger: params.trigger,
              },
            ),
          ),
        )
        .returning();

      // For each newly created topic, update the topicId of associated messages
      await Promise.all(
        createdTopics.map(async (topic, index) => {
          const messageIds = topicParams[index].messages;
          if (messageIds && messageIds.length > 0) {
            await tx
              .update(messages)
              .set({ topicId: topic.id })
              .where(and(this.messageOwnership(), inArray(messages.id, messageIds)));
          }
        }),
      );

      return createdTopics;
    });
  };

  duplicate = async (topicId: string, newTitle?: string) => {
    return this.db.transaction(async (tx) => {
      // find original topic
      const originalTopic = await tx.query.topics.findFirst({
        where: and(eq(topics.id, topicId), this.ownership()),
      });

      if (!originalTopic) {
        throw new Error(`Topic with id ${topicId} not found`);
      }

      // copy topic
      const [duplicatedTopic] = await tx
        .insert(topics)
        .values(
          buildWorkspacePayload(
            { userId: this.userId, workspaceId: this.workspaceId },
            {
              ...originalTopic,
              clientId: null,
              id: this.genId(),
              title: newTitle || originalTopic?.title,
            },
          ),
        )
        .returning();

      // Find messages associated with the original topic, ordered by createdAt
      const originalMessages = await tx
        .select()
        .from(messages)
        .where(and(eq(messages.topicId, topicId), this.messageOwnership()))
        .orderBy(messages.createdAt);

      // Find all messagePlugins for this topic
      const messageIds = originalMessages.map((m) => m.id);
      const originalPlugins =
        messageIds.length > 0
          ? await tx.select().from(messagePlugins).where(inArray(messagePlugins.id, messageIds))
          : [];

      // Build oldId -> newId mapping for messages
      const idMap = new Map<string, string>();
      originalMessages.forEach((message) => {
        idMap.set(message.id, idGenerator('messages'));
      });

      // Build oldToolId -> newToolId mapping for tools
      const toolIdMap = new Map<string, string>();
      originalMessages.forEach((message) => {
        if (message.tools && Array.isArray(message.tools)) {
          (message.tools as any[]).forEach((tool: any) => {
            if (tool.id) {
              toolIdMap.set(tool.id, `toolu_${idGenerator('messages')}`);
            }
          });
        }
      });

      // copy messages sequentially to respect foreign key constraints
      const duplicatedMessages: DBMessageItem[] = [];
      for (const message of originalMessages) {
        const newId = idMap.get(message.id)!;
        const newParentId = message.parentId ? idMap.get(message.parentId) || null : null;

        // Update tool IDs in tools array
        let newTools = message.tools;
        if (newTools && Array.isArray(newTools)) {
          newTools = (newTools as any[]).map((tool: any) => ({
            ...tool,
            id: tool.id ? toolIdMap.get(tool.id) || tool.id : tool.id,
          }));
        }

        const result = (await tx
          .insert(messages)
          .values({
            ...message,
            clientId: null,
            id: newId,
            parentId: newParentId,
            tools: newTools,
            topicId: duplicatedTopic.id,
          })
          .returning()) as DBMessageItem[];

        duplicatedMessages.push(result[0]);

        // Copy messagePlugins if exists for this message
        const plugin = originalPlugins.find((p) => p.id === message.id);
        if (plugin) {
          const newToolCallId = plugin.toolCallId ? toolIdMap.get(plugin.toolCallId) || null : null;

          await tx.insert(messagePlugins).values({
            ...plugin,
            clientId: null,
            id: newId,
            toolCallId: newToolCallId,
          });
        }
      }

      return {
        messages: duplicatedMessages,
        topic: duplicatedTopic,
      };
    });
  };

  // **************** Delete *************** //

  /**
   * Delete a session, also delete all messages and topics associated with it.
   */
  delete = async (id: string) => {
    return this.db.delete(topics).where(and(eq(topics.id, id), this.ownership()));
  };

  /**
   * Deletes multiple topics based on the sessionId.
   * `restrictToCreator` limits the sweep to the caller's own rows (workspace
   * non-owner members must not clear teammates' topics).
   */
  batchDeleteBySessionId = async (
    sessionId?: string | null,
    options?: { restrictToCreator?: boolean },
  ) => {
    return this.db
      .delete(topics)
      .where(
        and(
          this.matchSession(sessionId),
          options?.restrictToCreator ? this.mine() : this.ownership(),
        ),
      );
  };

  /**
   * Deletes multiple topics based on the groupId.
   * `restrictToCreator` limits the sweep to the caller's own rows in workspace mode.
   */
  batchDeleteByGroupId = async (
    groupId?: string | null,
    options?: { restrictToCreator?: boolean },
  ) => {
    return this.db
      .delete(topics)
      .where(
        and(this.matchGroup(groupId), options?.restrictToCreator ? this.mine() : this.ownership()),
      );
  };

  /**
   * Deletes all topics matching the given agentId (`topics.agentId`).
   * `restrictToCreator` limits the sweep to the caller's own rows (workspace
   * non-owner members must not clear teammates' topics).
   */
  batchDeleteByAgentId = async (agentId: string, options?: { restrictToCreator?: boolean }) => {
    return this.db
      .delete(topics)
      .where(
        and(
          options?.restrictToCreator ? this.mine() : this.ownership(),
          eq(topics.agentId, agentId),
        ),
      );
  };

  /**
   * Deletes multiple topics and all messages associated with them in a transaction.
   */
  batchDelete = async (ids: string[]) => {
    return this.db.delete(topics).where(and(inArray(topics.id, ids), this.ownership()));
  };

  deleteAll = async () => {
    return this.db.delete(topics).where(this.mine());
  };

  // **************** Update *************** //

  update = async (id: string, data: Partial<TopicItem>) => {
    return this.db
      .update(topics)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(topics.id, id), this.ownership()))
      .returning();
  };

  /**
   * Move multiple topics (and all their messages) to another agent.
   *
   * Reassigns ownership purely through the `agentId` foreign key (the new data
   * model). Every child entity of the topic that carries its own `agentId` FK
   * MUST be updated together — `topics`, `messages`, and `threads`. Topic lists
   * query by `topics.agentId` and message queries filter by `messages.agentId`,
   * so updating only the topic would leave the moved conversation showing up
   * empty under the target agent; and `threads.agentId` is itself a
   * cascade-on-delete FK, so a thread left pointing at the source agent would
   * be destroyed if that agent is later deleted.
   *
   * `sessionId` is cleared on `topics` and `messages` so the rows fully detach
   * from the source agent's legacy session and can't leak back through the
   * sessionId-based legacy query fallback (`threads` has no `sessionId`).
   *
   * Topics can only be moved to an agent owned by the same user/workspace. The
   * target agent is verified with the same ownership predicate before applying
   * the move — `topics.agentId` / `messages.agentId` are plain FKs to
   * `agents.id` with cascade-on-delete, so attaching rows to a foreign agent
   * would both leak them across tenants and risk losing them if that agent is
   * later deleted.
   */
  batchMoveToAgent = async (topicIds: string[], targetAgentId: string) => {
    if (topicIds.length === 0) return;

    return this.db.transaction(async (tx) => {
      const [targetAgent] = await tx
        .select({ id: agents.id })
        .from(agents)
        .where(
          and(
            eq(agents.id, targetAgentId),
            buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, agents),
          ),
        )
        .limit(1);

      if (!targetAgent) {
        throw new Error(`Target agent ${targetAgentId} not found or not accessible`);
      }

      await tx
        .update(topics)
        .set({ agentId: targetAgentId, sessionId: null, updatedAt: new Date() })
        .where(and(inArray(topics.id, topicIds), this.ownership()));

      await tx
        .update(messages)
        .set({ agentId: targetAgentId, sessionId: null })
        .where(and(inArray(messages.topicId, topicIds), this.messageOwnership()));

      await tx
        .update(threads)
        .set({ agentId: targetAgentId })
        .where(
          and(
            inArray(threads.topicId, topicIds),
            buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, threads),
          ),
        );
    });
  };

  /**
   * Recompute this topic's denormalized usage/cost rollup from its assistant
   * messages. The canonical aggregation lives in `recomputeTopicUsage`; the
   * live path (MessageModel) calls it inline within its own transaction, while
   * external callers use this wrapper. Runs in a transaction for consistency.
   */
  recomputeUsage = async (id: string) =>
    this.db.transaction((trx) => recomputeTopicUsage(trx, this.userId, id, this.workspaceId));

  /**
   * Update topic metadata with merge logic
   * This method merges new metadata with existing metadata instead of replacing it
   */
  updateMetadata = async (id: string, metadata: TopicMetadataPatch) => {
    // Merge into the existing metadata under a row lock so concurrent writers
    // can't lose each other's keys. The old read-then-write was a non-atomic
    // read-modify-write: a hetero run seeds `metadata.runningOperation` while
    // heteroIngest concurrently writes `metadata.heteroCurrentMsgId`, and a write
    // built on a stale snapshot (interleaved read, or a read-replica that hadn't
    // caught up) silently dropped `runningOperation` — stranding the finished
    // task at `task_topics.status = 'running'` because heteroFinish then had no
    // hooks to deliver. `SELECT … FOR UPDATE` forces a primary read + serializes
    // writers on the row, killing both the interleave and replica-lag variants
    // while preserving the exact (shallow + nested onboardingSession) merge.
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ metadata: topics.metadata })
        .from(topics)
        .where(and(eq(topics.id, id), this.ownership()))
        .for('update');

      // No row (missing or not owned) — nothing to update, mirror the old no-op.
      if (!existing) return [];

      const mergedOnboardingSession =
        existing.metadata?.onboardingSession && metadata.onboardingSession
          ? {
              ...existing.metadata.onboardingSession,
              ...metadata.onboardingSession,
            }
          : metadata.onboardingSession;

      const mergedMetadata = {
        ...existing.metadata,
        ...metadata,
        ...(mergedOnboardingSession && { onboardingSession: mergedOnboardingSession }),
      } as ChatTopicMetadata;

      return tx
        .update(topics)
        .set({ metadata: mergedMetadata })
        .where(and(eq(topics.id, id), this.ownership()))
        .returning();
    });
  };

  /**
   * Arm a scheduled run on an owned topic: writes `metadata.scheduledRun` and
   * flips the status to `scheduled` in a single update.
   *
   * The pair is one fact — a topic that is `scheduled` with no payload spins in
   * the dispatcher forever, and a payload on a non-`scheduled` topic never fires
   * — so they must never be written separately. The inverse is
   * {@link TopicModel.clearScheduledRun}.
   */
  armScheduledRun = async (id: string, scheduledRun: TopicScheduledRun): Promise<void> => {
    await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ metadata: topics.metadata })
        .from(topics)
        .where(and(eq(topics.id, id), this.ownership()))
        .for('update');

      if (!existing) return;

      await tx
        .update(topics)
        .set({
          metadata: { ...existing.metadata, scheduledRun } as ChatTopicMetadata,
          status: 'scheduled',
        })
        .where(and(eq(topics.id, id), this.ownership()));
    });
  };

  getCronTopicsGroupedByCronJob = async (
    agentId: string,
  ): Promise<{ cronJobId: string; topics: TopicItem[] }[]> => {
    const rows = await this.db
      .select()
      .from(topics)
      .where(
        and(
          this.ownership(),
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

  // **************** Helper *************** //

  private genId = () => idGenerator('topics');

  private matchSession = (sessionId?: string | null) =>
    sessionId ? eq(topics.sessionId, sessionId) : isNull(topics.sessionId);

  private matchGroup = (groupId?: string | null) =>
    groupId ? eq(topics.groupId, groupId) : isNull(topics.groupId);

  private matchContainer = (containerId?: string | null) => {
    if (containerId) return or(eq(topics.sessionId, containerId), eq(topics.groupId, containerId));
    // If neither is provided, match topics with no session or group
    return and(isNull(topics.sessionId), isNull(topics.groupId));
  };

  /**
   * Build the WHERE condition that scopes a keyword search to a single
   * conversation owner. Mirrors {@link TopicModel.query}'s precedence and
   * conditions exactly (groupId > agentId > containerId), so search returns the
   * same set the topics list shows.
   *
   * The agent branch matches `topics.agentId` directly — the new agent system
   * stamps every topic with an agentId, and the old `matchContainer` path
   * (sessionId / groupId only) would miss those rows entirely. It deliberately
   * does NOT fall back to the resolved sessionId: the list has no such fallback
   * either, so adding one would (a) surface un-migrated rows the list hides and
   * (b) leak topics owned by another agent that shares the same session mapping.
   * Legacy rows are backfilled with an agentId by the migration the list query
   * triggers, after which the agentId match finds them.
   */
  private matchKeywordScope = ({
    agentId,
    containerId,
    groupId,
  }: TopicKeywordScope): SQL | undefined => {
    if (groupId) return eq(topics.groupId, groupId);
    if (agentId) return eq(topics.agentId, agentId);
    return this.matchContainer(containerId);
  };

  listTopicsForMemoryExtractor = async (
    options: {
      cursor?: ListTopicsForMemoryExtractorCursor;
      endDate?: Date;
      ignoreExtracted?: boolean;
      limit?: number;
      startDate?: Date;
    } = {},
  ) => {
    const cursorCondition = options.cursor
      ? and(
          ne(topics.id, options.cursor.id),
          or(
            gt(topics.createdAt, options.cursor.createdAt),
            and(eq(topics.createdAt, options.cursor.createdAt), gt(topics.id, options.cursor.id)),
          ),
        )
      : undefined;

    return this.db.query.topics.findMany({
      columns: {
        createdAt: true,
        id: true,
        metadata: true,
        userId: true,
      },
      limit: options.limit,
      orderBy: (fields, { asc }) => [asc(fields.createdAt), asc(fields.id)],
      where: and(
        this.ownership(),
        options.startDate ? gte(topics.createdAt, options.startDate) : undefined,
        options.endDate ? lte(topics.createdAt, options.endDate) : undefined,
        options.ignoreExtracted
          ? undefined
          : // COALESCE, not `IS DISTINCT FROM`: a null test on a jsonb arrow
            // expression crashes the production engine (see the note on the class).
            // A null `metadata` extracts to '' here too, so this covers it.
            sql`COALESCE(${topics.metadata}->>'userMemoryExtractStatus', '') <> 'completed'`,
        cursorCondition,
      ),
    });
  };

  countTopicsForMemoryExtractor = async (
    options: {
      endDate?: Date;
      ignoreExtracted?: boolean;
      startDate?: Date;
    } = {},
  ) => {
    const result = await this.db
      .select({ total: count(topics.id) })
      .from(topics)
      .where(
        and(
          this.ownership(),
          options.startDate ? gte(topics.createdAt, options.startDate) : undefined,
          options.endDate ? lte(topics.createdAt, options.endDate) : undefined,
          options.ignoreExtracted
            ? undefined
            : sql`COALESCE(${topics.metadata}->>'userMemoryExtractStatus', '') <> 'completed'`,
        ),
      );

    return result[0]?.total ?? 0;
  };

  // **************** Scheduled run (backend cron) *************** //

  /**
   * Topics with a scheduled run that has come due.
   * System-level sweep (no ownership filter) used by the cron dispatcher.
   *
   * Due = `status = 'scheduled'` AND the run's gate has passed AND there is no
   * live claim (`scheduledRun.claim.expiresAt` is absent, or already expired) —
   * so a topic another replica is mid-dispatch on is skipped.
   *
   * `runAt` is the gate for every {@link TopicScheduledRunKind}: a row carrying a
   * `kind` but no `runAt` is never due, which is what keeps a half-written
   * scheduled topic from being dispatched immediately.
   *
   * The one exception is a row parked by the pre-`kind` version, which has no
   * `runAt` and gated on the rate-limit reset instead. Those are still in the DB
   * on deploy, so this reproduces their old gate rather than stranding them at
   * `scheduled` forever — matching `parseTopicScheduledRun`, which upgrades the
   * payload the dispatcher then reads.
   */
  static async getDueScheduledTopics(
    db: LobeChatDatabase,
    now: Date = new Date(),
  ): Promise<TopicItem[]> {
    const nowIso = now.toISOString();
    const nowEpochSeconds = Math.floor(now.getTime() / 1000);

    // Every jsonb path below is COALESCE'd to a sentinel rather than null-tested:
    // `#>> … IS NULL` in a WHERE clause takes the production engine down. See the
    // note on the class.
    const runAt = sql`COALESCE(${topics.metadata}#>>'{scheduledRun,runAt}', '')`;

    return db
      .select()
      .from(topics)
      .where(
        and(
          eq(topics.status, 'scheduled'),
          or(
            // `''` is the absent-runAt sentinel, and it never satisfies this pair —
            // an absent gate must not read as "due now", which is what keeps a
            // half-written schedule parked.
            and(sql`${runAt} <> ''`, sql`${runAt} <= ${nowIso}`),
            // Legacy (pre-`kind`) payload: no `runAt`, gated on the rate-limit
            // reset, and an absent reset read as "due now" (hence the 0 default).
            and(
              sql`${runAt} = ''`,
              sql`COALESCE(${topics.metadata}#>>'{scheduledRun,reason}', '') = 'rate_limit'`,
              sql`COALESCE((${topics.metadata}#>>'{scheduledRun,rateLimit,resetsAt}')::numeric, 0) <= ${nowEpochSeconds}`,
            ),
          ),
          // No claim, or the lease has expired. `''` (no claim) sorts before every
          // ISO timestamp, so the same comparison covers both.
          sql`COALESCE(${topics.metadata}#>>'{scheduledRun,claim,expiresAt}', '') <= ${nowIso}`,
        ),
      );
  }

  /**
   * Atomically claim a scheduled topic before dispatch, so two concurrent cron
   * ticks can't trigger the same continuation twice. Serializes on the row with
   * `SELECT … FOR UPDATE` (mirrors {@link updateMetadata}) and only writes the
   * lease if the topic is still `scheduled` and not already claimed by a live
   * lease. Returns `true` when this caller won the claim.
   */
  static async claimScheduledTopic(
    db: LobeChatDatabase,
    id: string,
    claim: { claimedAt: string; expiresAt: string; id: string },
    now: Date = new Date(),
  ): Promise<boolean> {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select({ metadata: topics.metadata, status: topics.status })
        .from(topics)
        .where(eq(topics.id, id))
        .for('update');

      if (!row || row.status !== 'scheduled') return false;

      const scheduledRun = row.metadata?.scheduledRun;
      if (!scheduledRun) return false;

      const existingClaim = scheduledRun.claim;
      const claimLive = existingClaim && new Date(existingClaim.expiresAt) > now;
      if (claimLive) return false;

      await tx
        .update(topics)
        .set({
          metadata: {
            ...row.metadata,
            scheduledRun: { ...scheduledRun, claim },
          } as ChatTopicMetadata,
        })
        .where(eq(topics.id, id));

      return true;
    });
  }

  /**
   * Clear the scheduled continuation and restore a normal status. Used both when
   * a continuation is successfully dispatched/executed and when it is cancelled.
   */
  static async clearScheduledRun(
    db: LobeChatDatabase,
    id: string,
    nextStatus: ChatTopicStatus = 'active',
    expectedClaimId?: string,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ metadata: topics.metadata, status: topics.status })
        .from(topics)
        .where(eq(topics.id, id))
        .for('update');
      if (!row || row.status !== 'scheduled') return;
      if (expectedClaimId && row.metadata?.scheduledRun?.claim?.id !== expectedClaimId) return;

      const nextMetadata = { ...row.metadata, scheduledRun: null } as ChatTopicMetadata;
      await tx
        .update(topics)
        .set({ metadata: nextMetadata, status: nextStatus })
        .where(eq(topics.id, id));
    });
  }

  /**
   * Re-point a still-pending scheduled run at a new failed-attempt message. A
   * dispatch that fails inside execAgent leaves its own error bubble on the
   * placeholder it created; tracking that bubble as the run's
   * `failedAssistantMessageId` lets the next tick's pre-dispatch cleanup clear
   * it the same way it clears the original card, so retries don't strand one
   * stale error bubble per failed attempt.
   *
   * `expectedClaimId` fences stale writers the same way it does in
   * {@link TopicModel.clearScheduledRun}: a dispatch attempt that outlived its
   * claim lease — or one whose schedule the user cancelled and re-armed — must
   * not overwrite the pointer of a NEWER scheduled run, or the next cleanup
   * would delete / anchor against an unrelated message. No-ops when the
   * schedule was cleared or the claim no longer matches.
   */
  static async repointScheduledRunFailedMessage(
    db: LobeChatDatabase,
    id: string,
    failedAssistantMessageId: string,
    expectedClaimId: string,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ metadata: topics.metadata, status: topics.status })
        .from(topics)
        .where(eq(topics.id, id))
        .for('update');
      if (!row || row.status !== 'scheduled') return;

      const scheduledRun = row.metadata?.scheduledRun;
      if (!scheduledRun) return;
      if (scheduledRun.claim?.id !== expectedClaimId) return;

      await tx
        .update(topics)
        .set({
          metadata: {
            ...row.metadata,
            scheduledRun: {
              ...scheduledRun,
              failedAssistantMessageId,
              updatedAt: new Date().toISOString(),
            },
          } as ChatTopicMetadata,
        })
        .where(eq(topics.id, id));
    });
  }
}
