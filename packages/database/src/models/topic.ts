import type {
  ChatTopicMetadata,
  ChatTopicStatus,
  DBMessageItem,
  TopicQuerySortBy,
  TopicRankItem,
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
import { agents, messagePlugins, messages, topics } from '../schemas';
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

export interface CreateTopicParams {
  agentId?: string | null;
  favorite?: boolean;
  groupId?: string | null;
  messages?: string[];
  metadata?: ChatTopicMetadata;
  sessionId?: string | null;
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

export interface ListTopicsForMemoryExtractorCursor {
  createdAt: Date;
  id: string;
}

// Status priority for the sidebar "group by status" ordering. Lower rank =
// higher in the list. A NULL / unknown status falls through to `active` (3),
// matching the client which treats a missing status as active. Keep this in
// sync with `STATUS_GROUP_ORDER` / `resolveStatusBucket` in `@lobechat/utils`
// (client-side bucketing): `waitingForHuman` and `failed` both collapse into the
// top `pending` bucket, so they must float to the top here too — otherwise a
// failed topic could fall off the first page and vanish from the pending group.
const STATUS_SORT_RANK = sql`CASE ${topics.status}
  WHEN 'waitingForHuman' THEN 0
  WHEN 'failed' THEN 1
  WHEN 'running' THEN 2
  WHEN 'active' THEN 3
  WHEN 'paused' THEN 4
  WHEN 'completed' THEN 5
  WHEN 'archived' THEN 6
  ELSE 3 END`;

// Favorites always float to the top; the rest are ordered by the requested
// strategy. `status` adds the priority bucket before the recency tiebreaker.
const buildTopicOrderBy = (sortBy?: TopicQuerySortBy): SQL[] =>
  sortBy === 'status'
    ? [desc(topics.favorite), asc(STATUS_SORT_RANK), desc(topics.updatedAt)]
    : [desc(topics.favorite), desc(topics.updatedAt)];

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
    const orderBy = buildTopicOrderBy(sortBy);
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
                status: topics.status,
                title: topics.title,
                updatedAt: topics.updatedAt,
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
                status: topics.status,
                title: topics.title,
                updatedAt: topics.updatedAt,
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
              sessionId: topics.sessionId,
              status: topics.status,
              title: topics.title,
              updatedAt: topics.updatedAt,
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

    const cleanItems = items.map(({ agentId, sessionId, ...rest }) => rest);

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

  queryAll = async (): Promise<TopicItem[]> => {
    return this.db.select().from(topics).orderBy(topics.updatedAt).where(and(this.ownership()));
  };

  queryByKeyword = async (keyword: string, containerId?: string | null): Promise<TopicItem[]> => {
    if (!keyword.trim()) return [];

    const bm25Query = sanitizeBm25Query(keyword);

    // Run title and message content searches in parallel
    const [topicsByTitle, topicIdsByMessages] = await Promise.all([
      // Query topics matching by title (BM25)
      this.db
        .select()
        .from(topics)
        .where(
          and(
            this.ownership(),
            this.matchContainer(containerId),
            sql`${topics.title} @@@ ${bm25Query}`,
          ),
        )
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
            this.matchContainer(containerId),
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
    const result = await this.db
      .select({
        agentId: topics.agentId,
        groupId: topics.groupId,
        id: topics.id,
        sessionId: topics.sessionId,
        title: topics.title,
        updatedAt: topics.updatedAt,
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
      .orderBy(desc(topics.updatedAt))
      .limit(limit);

    return result.map((item) => ({
      ...item,
      type: item.groupId ? ('group' as const) : ('agent' as const),
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
   */
  batchDeleteBySessionId = async (sessionId?: string | null) => {
    return this.db.delete(topics).where(and(this.matchSession(sessionId), this.ownership()));
  };

  /**
   * Deletes multiple topics based on the groupId.
   */
  batchDeleteByGroupId = async (groupId?: string | null) => {
    return this.db.delete(topics).where(and(this.matchGroup(groupId), this.ownership()));
  };

  /**
   * Deletes all topics matching the given agentId (`topics.agentId`).
   */
  batchDeleteByAgentId = async (agentId: string) => {
    return this.db.delete(topics).where(and(this.ownership(), eq(topics.agentId, agentId)));
  };

  /**
   * Deletes multiple topics and all messages associated with them in a transaction.
   */
  batchDelete = async (ids: string[]) => {
    return this.db.delete(topics).where(and(inArray(topics.id, ids), this.ownership()));
  };

  deleteAll = async () => {
    return this.db.delete(topics).where(and(this.ownership()));
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
    // Get existing topic to merge metadata
    const existing = await this.db.query.topics.findFirst({
      columns: { metadata: true },
      where: and(eq(topics.id, id), this.ownership()),
    });

    const mergedOnboardingSession =
      existing?.metadata?.onboardingSession && metadata.onboardingSession
        ? {
            ...existing.metadata.onboardingSession,
            ...metadata.onboardingSession,
          }
        : metadata.onboardingSession;

    const mergedMetadata = {
      ...existing?.metadata,
      ...metadata,
      ...(mergedOnboardingSession && { onboardingSession: mergedOnboardingSession }),
    } as ChatTopicMetadata;

    return this.db
      .update(topics)
      .set({ metadata: mergedMetadata })
      .where(and(eq(topics.id, id), this.ownership()))
      .returning();
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
          sql`(${topics.metadata}->>'cronJobId') IS NOT NULL`,
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
          : or(
              isNull(topics.metadata),
              sql`(${topics.metadata}->>'userMemoryExtractStatus') IS DISTINCT FROM 'completed'`,
            ),
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
            : or(
                isNull(topics.metadata),
                sql`(${topics.metadata}->>'userMemoryExtractStatus') IS DISTINCT FROM 'completed'`,
              ),
        ),
      );

    return result[0]?.total ?? 0;
  };
}
