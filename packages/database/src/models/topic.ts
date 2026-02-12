import type { ChatTopicMetadata, DBMessageItem, TopicRankItem } from '@lobechat/types';
import type { SQL } from 'drizzle-orm';
import {
  and,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  ne,
  not,
  or,
  sql,
} from 'drizzle-orm';

import type { TopicItem } from '../schemas';
import { agents, agentsToSessions, messagePlugins, messages, topics } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { genEndDateWhere, genRangeWhere, genStartDateWhere, genWhere } from '../utils/genWhere';
import { idGenerator } from '../utils/idGenerator';

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
   * Exclude topics by trigger types (e.g. ['cron'])
   */
  excludeTriggers?: string[];
  /**
   * Group ID to filter topics by
   */
  groupId?: string | null;
  /**
   * Whether this is an inbox agent query.
   * When true, also includes legacy inbox topics (sessionId IS NULL AND groupId IS NULL AND agentId IS NULL)
   */
  isInbox?: boolean;
  pageSize?: number;
}

export interface ListTopicsForMemoryExtractorCursor {
  createdAt: Date;
  id: string;
}

export class TopicModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }
  // **************** Query *************** //

  query = async ({
    agentId,
    containerId,
    current = 0,
    excludeTriggers,
    pageSize = 9999,
    groupId,
    isInbox,
  }: QueryTopicParams = {}) => {
    const offset = current * pageSize;
    const excludeTriggerCondition =
      excludeTriggers && excludeTriggers.length > 0
        ? or(isNull(topics.trigger), not(inArray(topics.trigger, excludeTriggers)))
        : undefined;

    // If groupId is provided, query topics by groupId directly
    if (groupId) {
      const whereCondition = and(
        eq(topics.userId, this.userId),
        eq(topics.groupId, groupId),
        excludeTriggerCondition,
      );

      const [items, totalResult] = await Promise.all([
        this.db
          .select({
            createdAt: topics.createdAt,
            favorite: topics.favorite,
            historySummary: topics.historySummary,
            id: topics.id,
            metadata: topics.metadata,
            title: topics.title,
            updatedAt: topics.updatedAt,
          })
          .from(topics)
          .where(whereCondition)
          .orderBy(desc(topics.favorite), desc(topics.updatedAt))
          .limit(pageSize)
          .offset(offset),
        this.db
          .select({ count: count(topics.id) })
          .from(topics)
          .where(whereCondition),
      ]);

      return { items, total: totalResult[0].count };
    }

    // If agentId is provided, query topics that match either:
    // 1. topics.agentId = agentId (new data with agentId stored directly)
    // 2. topics.sessionId = associated sessionId (legacy data via agentsToSessions lookup)
    // 3. For inbox: sessionId IS NULL AND groupId IS NULL AND agentId IS NULL (legacy inbox data)
    if (agentId) {
      // Get the associated sessionId for backward compatibility with legacy data
      const agentSession = await this.db
        .select({ sessionId: agentsToSessions.sessionId })
        .from(agentsToSessions)
        .where(and(eq(agentsToSessions.agentId, agentId), eq(agentsToSessions.userId, this.userId)))
        .limit(1);

      const associatedSessionId = agentSession[0]?.sessionId;

      // Build condition to match both new (agentId) and legacy (sessionId) data
      let agentCondition;
      if (isInbox) {
        // For inbox agent: query topics that match:
        // 1. topics.agentId = agentId (new data)
        // 2. topics.sessionId = associatedSessionId (legacy data with session relation)
        // 3. sessionId IS NULL AND groupId IS NULL AND agentId IS NULL (very old legacy inbox data)
        const conditions = [
          eq(topics.agentId, agentId),
          and(isNull(topics.sessionId), isNull(topics.groupId), isNull(topics.agentId)),
        ];
        // Also include topics linked via legacy session relation
        if (associatedSessionId) {
          conditions.push(eq(topics.sessionId, associatedSessionId));
        }
        agentCondition = or(...conditions);
      } else if (associatedSessionId) {
        agentCondition = or(eq(topics.agentId, agentId), eq(topics.sessionId, associatedSessionId));
      } else {
        agentCondition = eq(topics.agentId, agentId);
      }

      // Fetch items and total count in parallel
      // Include sessionId and agentId for migration detection
      const [items, totalResult] = await Promise.all([
        this.db
          .select({
            createdAt: topics.createdAt,
            favorite: topics.favorite,
            historySummary: topics.historySummary,
            id: topics.id,
            metadata: topics.metadata,
            title: topics.title,
            updatedAt: topics.updatedAt,
          })
          .from(topics)
          .where(and(eq(topics.userId, this.userId), agentCondition, excludeTriggerCondition))
          .orderBy(desc(topics.favorite), desc(topics.updatedAt))
          .limit(pageSize)
          .offset(offset),
        this.db
          .select({ count: count(topics.id) })
          .from(topics)
          .where(and(eq(topics.userId, this.userId), agentCondition, excludeTriggerCondition)),
      ]);

      return { items, total: totalResult[0].count };
    }

    // Fallback to containerId-based query (backward compatibility)
    const whereCondition = and(
      eq(topics.userId, this.userId),
      this.matchContainer(containerId),
      excludeTriggerCondition,
    );

    const [items, totalResult] = await Promise.all([
      this.db
        .select({
          agentId: topics.agentId,
          createdAt: topics.createdAt,
          favorite: topics.favorite,
          historySummary: topics.historySummary,
          id: topics.id,
          metadata: topics.metadata,
          sessionId: topics.sessionId,
          title: topics.title,
          updatedAt: topics.updatedAt,
        })
        .from(topics)
        .where(whereCondition)
        // In boolean sorting, false is considered "smaller" than true.
        // So here we use desc to ensure that topics with favorite as true are in front.
        .orderBy(desc(topics.favorite), desc(topics.updatedAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count(topics.id) })
        .from(topics)
        .where(whereCondition),
    ]);

    // Remove internal fields before returning

    const cleanItems = items.map(({ agentId, sessionId, ...rest }) => rest);

    return { items: cleanItems, total: totalResult[0].count };
  };

  findById = async (id: string) => {
    return this.db.query.topics.findFirst({
      where: and(eq(topics.id, id), eq(topics.userId, this.userId)),
    });
  };

  queryAll = async (): Promise<TopicItem[]> => {
    return this.db
      .select()
      .from(topics)
      .orderBy(topics.updatedAt)
      .where(eq(topics.userId, this.userId));
  };

  queryByKeyword = async (keyword: string, containerId?: string | null): Promise<TopicItem[]> => {
    if (!keyword) return [];

    const keywordLowerCase = keyword.toLowerCase();

    // Query topics matching by title
    const topicsByTitle = await this.db.query.topics.findMany({
      orderBy: [desc(topics.updatedAt)],
      where: and(
        eq(topics.userId, this.userId),
        this.matchContainer(containerId),
        ilike(topics.title, `%${keywordLowerCase}%`),
      ),
    });

    // Query topic IDs matching by message content
    const topicIdsByMessages = await this.db
      .select({ topicId: messages.topicId })
      .from(messages)
      .innerJoin(topics, eq(messages.topicId, topics.id))
      .where(
        and(
          eq(messages.userId, this.userId),
          ilike(messages.content, `%${keywordLowerCase}%`),
          eq(topics.userId, this.userId),
          this.matchContainer(containerId),
        ),
      )
      .groupBy(messages.topicId);
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
      where: and(eq(topics.userId, this.userId), inArray(topics.id, topicIds)),
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
    let agentCondition: SQL | undefined;
    if (params?.agentId) {
      // Get the associated sessionId for backward compatibility with legacy data
      const agentSession = await this.db
        .select({ sessionId: agentsToSessions.sessionId })
        .from(agentsToSessions)
        .where(
          and(
            eq(agentsToSessions.agentId, params.agentId),
            eq(agentsToSessions.userId, this.userId),
          ),
        )
        .limit(1);

      const associatedSessionId = agentSession[0]?.sessionId;

      // Build condition to match both new (agentId) and legacy (sessionId) data
      agentCondition = associatedSessionId
        ? or(eq(topics.agentId, params.agentId), eq(topics.sessionId, associatedSessionId))
        : eq(topics.agentId, params.agentId);
    }

    const result = await this.db
      .select({
        count: count(topics.id),
      })
      .from(topics)
      .where(
        genWhere([
          eq(topics.userId, this.userId),
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
        count: count(messages.id).as('count'),
        id: topics.id,
        sessionId: topics.sessionId,
        title: topics.title,
      })
      .from(topics)
      .where(and(eq(topics.userId, this.userId)))
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
          eq(topics.userId, this.userId),
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
  ): Promise<TopicItem> => {
    return this.db.transaction(async (tx) => {
      const insertData = {
        ...params,
        agentId: params.agentId || null,
        groupId: params.groupId || null,
        id,
        sessionId: params.sessionId || null,
        userId: this.userId,
      };

      // Insert new topic
      const [topic] = await tx.insert(topics).values(insertData).returning();

      // Update associated messages' topicId
      if (messageIds && messageIds.length > 0) {
        await tx
          .update(messages)
          .set({ topicId: topic.id })
          .where(and(eq(messages.userId, this.userId), inArray(messages.id, messageIds)));
      }

      return topic;
    });
  };

  batchCreate = async (topicParams: (CreateTopicParams & { id?: string })[]) => {
    // Start a transaction
    return this.db.transaction(async (tx) => {
      // Batch insert new topics into the topics table
      const createdTopics = await tx
        .insert(topics)
        .values(
          topicParams.map((params) => ({
            agentId: params.agentId || null,
            favorite: params.favorite,
            groupId: params.sessionId ? null : params.groupId,
            id: params.id || this.genId(),
            sessionId: params.groupId ? null : params.sessionId,
            title: params.title,
            userId: this.userId,
          })),
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
              .where(and(eq(messages.userId, this.userId), inArray(messages.id, messageIds)));
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
        where: and(eq(topics.id, topicId), eq(topics.userId, this.userId)),
      });

      if (!originalTopic) {
        throw new Error(`Topic with id ${topicId} not found`);
      }

      // copy topic
      const [duplicatedTopic] = await tx
        .insert(topics)
        .values({
          ...originalTopic,
          clientId: null,
          id: this.genId(),
          title: newTitle || originalTopic?.title,
        })
        .returning();

      // Find messages associated with the original topic, ordered by createdAt
      const originalMessages = await tx
        .select()
        .from(messages)
        .where(and(eq(messages.topicId, topicId), eq(messages.userId, this.userId)))
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
    return this.db.delete(topics).where(and(eq(topics.id, id), eq(topics.userId, this.userId)));
  };

  /**
   * Deletes multiple topics based on the sessionId.
   */
  batchDeleteBySessionId = async (sessionId?: string | null) => {
    return this.db
      .delete(topics)
      .where(and(this.matchSession(sessionId), eq(topics.userId, this.userId)));
  };

  /**
   * Deletes multiple topics based on the groupId.
   */
  batchDeleteByGroupId = async (groupId?: string | null) => {
    return this.db
      .delete(topics)
      .where(and(this.matchGroup(groupId), eq(topics.userId, this.userId)));
  };

  /**
   * Deletes multiple topics based on the agentId.
   * This will delete topics that have either:
   * 1. Direct agentId match (new data)
   * 2. SessionId match via agentsToSessions lookup (legacy data)
   */
  batchDeleteByAgentId = async (agentId: string) => {
    // Get the associated sessionId for backward compatibility with legacy data
    const agentSession = await this.db
      .select({ sessionId: agentsToSessions.sessionId })
      .from(agentsToSessions)
      .where(and(eq(agentsToSessions.agentId, agentId), eq(agentsToSessions.userId, this.userId)))
      .limit(1);

    const associatedSessionId = agentSession[0]?.sessionId;

    // Build condition to match both new (agentId) and legacy (sessionId) data
    const agentCondition = associatedSessionId
      ? or(eq(topics.agentId, agentId), eq(topics.sessionId, associatedSessionId))
      : eq(topics.agentId, agentId);

    return this.db.delete(topics).where(and(eq(topics.userId, this.userId), agentCondition));
  };

  /**
   * Deletes multiple topics and all messages associated with them in a transaction.
   */
  batchDelete = async (ids: string[]) => {
    return this.db
      .delete(topics)
      .where(and(inArray(topics.id, ids), eq(topics.userId, this.userId)));
  };

  deleteAll = async () => {
    return this.db.delete(topics).where(eq(topics.userId, this.userId));
  };

  // **************** Update *************** //

  update = async (id: string, data: Partial<TopicItem>) => {
    return this.db
      .update(topics)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(topics.id, id), eq(topics.userId, this.userId)))
      .returning();
  };

  /**
   * Update topic metadata with merge logic
   * This method merges new metadata with existing metadata instead of replacing it
   */
  updateMetadata = async (id: string, metadata: Partial<ChatTopicMetadata>) => {
    // Get existing topic to merge metadata
    const existing = await this.db.query.topics.findFirst({
      columns: { metadata: true },
      where: and(eq(topics.id, id), eq(topics.userId, this.userId)),
    });

    const mergedMetadata: ChatTopicMetadata = {
      ...existing?.metadata,
      ...metadata,
    };

    return this.db
      .update(topics)
      .set({ metadata: mergedMetadata })
      .where(and(eq(topics.id, id), eq(topics.userId, this.userId)))
      .returning();
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
        eq(topics.userId, this.userId),
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
          eq(topics.userId, this.userId),
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

  /**
   * Get cron topics grouped by cronJob for a specific agent
   * Returns topics where trigger='cron' and metadata contains cronJobId
   */
  getCronTopicsGroupedByCronJob = async (agentId: string) => {
    const cronTopics = await this.db
      .select({
        createdAt: topics.createdAt,
        favorite: topics.favorite,
        historySummary: topics.historySummary,
        id: topics.id,
        metadata: topics.metadata,
        title: topics.title,
        trigger: topics.trigger,
        updatedAt: topics.updatedAt,
      })
      .from(topics)
      .where(
        and(
          eq(topics.userId, this.userId),
          eq(topics.agentId, agentId),
          eq(topics.trigger, 'cron'),
          // Check if metadata contains cronJobId
          sql`${topics.metadata}->>'cronJobId' IS NOT NULL`,
        ),
      )
      .orderBy(desc(topics.updatedAt));

    // Group topics by cronJobId
    const groupedTopics = new Map<string, typeof cronTopics>();

    cronTopics.forEach((topic) => {
      const cronJobId = topic.metadata?.cronJobId;
      if (cronJobId) {
        if (!groupedTopics.has(cronJobId)) {
          groupedTopics.set(cronJobId, []);
        }
        groupedTopics.get(cronJobId)!.push(topic);
      }
    });

    // Convert Map to array of grouped objects
    return Array.from(groupedTopics.entries()).map(([cronJobId, topicList]) => ({
      cronJobId,
      topics: topicList,
    }));
  };
}
