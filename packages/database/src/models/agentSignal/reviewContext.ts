import { and, count, desc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';

import {
  agentDocuments,
  agents,
  documents,
  messagePlugins,
  messages,
  topics,
  userMemories,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';

const parseAggregateTimestamp = (value: Date | string) =>
  value instanceof Date ? value : new Date(value);

export interface ListAgentSignalTopicActivityOptions {
  agentId: string;
  limit: number;
  windowEnd: Date;
  windowStart: Date;
}

export interface ListAgentSignalSelfReflectionTopicOptions {
  agentId: string;
  topicId: string;
  windowEnd: Date;
  windowStart: Date;
}

export interface ListAgentSignalRelevantMemoriesOptions {
  limit: number;
}

export interface ListAgentSignalActivityWindowOptions {
  agentId: string;
  windowEnd: Date;
  windowStart: Date;
}

export interface AgentSignalTopicActivityRow {
  failedMessages: AgentSignalFailedMessageSummary[];
  failedToolCalls: AgentSignalFailedToolCallSummary[];
  failedToolCount: number;
  failureCount: number;
  lastActivityAt: Date | null;
  messageCount: number;
  summary: string;
  title: string | null;
  topicId: string | null;
}

export interface AgentSignalFailedToolCallSummary {
  apiName: string | null;
  errorSummary: string | null;
  identifier: string | null;
  messageId: string;
  toolCallId: string | null;
}

export interface AgentSignalFailedMessageSummary {
  errorSummary: string | null;
  messageId: string;
}

export interface AgentSignalRelevantMemoryRow {
  content: string;
  id: string;
  updatedAt: Date;
}

export interface AgentSignalToolActivityRow {
  apiName: string | null;
  failedCount: number;
  firstUsedAt: Date | null;
  identifier: string | null;
  lastUsedAt: Date | null;
  messageIds: string[];
  sampleArgs: string[];
  sampleErrors: string[];
  topicIds: string[];
  totalCount: number;
}

export interface AgentSignalDocumentActivityRow {
  agentDocumentId: string;
  documentId: string;
  hintIsSkill: boolean | null;
  policyLoadFormat: string;
  templateId: string | null;
  title: string | null;
  updatedAt: Date;
}

/** Database-backed context queries for Agent Signal self-review policies. */
export class AgentSignalReviewContextModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  /** Checks agent ownership, virtual status, and self-iteration opt-in. */
  canAgentRunSelfIteration = async (agentId: string) => {
    const [agent] = await this.db
      .select({ id: agents.id })
      .from(agents)
      .where(
        and(
          eq(agents.id, agentId),
          eq(agents.userId, this.userId),
          or(eq(agents.virtual, false), isNull(agents.virtual)),
          sql`COALESCE((${agents.chatConfig}->'selfIteration'->>'enabled')::boolean, false) = true`,
        ),
      )
      .limit(1);

    return Boolean(agent);
  };

  /** Lists recent memory summaries for review context. */
  listRelevantMemories = (options: ListAgentSignalRelevantMemoriesOptions) => {
    return this.db
      .select({
        content: sql<string>`COALESCE(${userMemories.summary}, ${userMemories.title}, ${userMemories.details}, '')`,
        id: userMemories.id,
        updatedAt: userMemories.updatedAt,
      })
      .from(userMemories)
      .where(eq(userMemories.userId, this.userId))
      .orderBy(desc(userMemories.updatedAt))
      .limit(options.limit);
  };

  /** Lists grouped review-window tool activity for nightly maintenance context. */
  listToolActivity = (options: ListAgentSignalActivityWindowOptions) => {
    const effectiveAgentId = sql<string>`COALESCE(${messages.agentId}, ${topics.agentId})`;

    return this.db
      .select({
        apiName: messagePlugins.apiName,
        failedCount:
          sql<number>`COUNT(${messagePlugins.id}) FILTER (WHERE ${messagePlugins.error} IS NOT NULL)`.mapWith(
            Number,
          ),
        firstUsedAt: sql<Date>`MIN(${messages.createdAt})`.mapWith(parseAggregateTimestamp),
        identifier: messagePlugins.identifier,
        lastUsedAt: sql<Date>`MAX(${messages.createdAt})`.mapWith(parseAggregateTimestamp),
        messageIds: sql<string[]>`
          COALESCE(
            jsonb_agg(DISTINCT ${messages.id}) FILTER (WHERE ${messages.id} IS NOT NULL),
            '[]'::jsonb
          )
        `,
        sampleArgs: sql<string[]>`
          COALESCE(
            jsonb_agg(DISTINCT left(${messagePlugins.arguments}::text, 500))
              FILTER (WHERE ${messagePlugins.arguments} IS NOT NULL),
            '[]'::jsonb
          )
        `,
        sampleErrors: sql<string[]>`
          COALESCE(
            jsonb_agg(DISTINCT left(${messagePlugins.error}::text, 500))
              FILTER (WHERE ${messagePlugins.error} IS NOT NULL),
            '[]'::jsonb
          )
        `,
        topicIds: sql<string[]>`
          COALESCE(
            jsonb_agg(DISTINCT ${messages.topicId}) FILTER (WHERE ${messages.topicId} IS NOT NULL),
            '[]'::jsonb
          )
        `,
        totalCount: count(messagePlugins.id),
      })
      .from(messagePlugins)
      .innerJoin(
        messages,
        and(eq(messages.id, messagePlugins.id), eq(messages.userId, this.userId)),
      )
      .leftJoin(topics, and(eq(topics.id, messages.topicId), eq(topics.userId, this.userId)))
      .where(
        and(
          eq(messagePlugins.userId, this.userId),
          eq(effectiveAgentId, options.agentId),
          gte(messages.createdAt, options.windowStart),
          lte(messages.createdAt, options.windowEnd),
        ),
      )
      .groupBy(messagePlugins.identifier, messagePlugins.apiName)
      .orderBy(desc(sql`COUNT(${messagePlugins.id})`))
      .limit(20);
  };

  /** Lists review-window agent document activity for nightly maintenance context. */
  listDocumentActivity = (options: ListAgentSignalActivityWindowOptions) => {
    return this.db
      .select({
        agentDocumentId: agentDocuments.id,
        documentId: agentDocuments.documentId,
        hintIsSkill: sql<boolean | null>`
          CASE
            WHEN ${documents.metadata}->'agentSignal'->>'hintIsSkill' = 'true' THEN true
            WHEN ${documents.metadata}->'agentSignal'->>'hintIsSkill' = 'false' THEN false
            ELSE NULL
          END
        `,
        policyLoadFormat: agentDocuments.policyLoadFormat,
        templateId: agentDocuments.templateId,
        title: documents.title,
        updatedAt: agentDocuments.updatedAt,
      })
      .from(agentDocuments)
      .innerJoin(
        documents,
        and(eq(documents.id, agentDocuments.documentId), eq(documents.userId, this.userId)),
      )
      .where(
        and(
          eq(agentDocuments.userId, this.userId),
          eq(agentDocuments.agentId, options.agentId),
          isNull(agentDocuments.deletedAt),
          gte(agentDocuments.updatedAt, options.windowStart),
          lte(agentDocuments.updatedAt, options.windowEnd),
        ),
      )
      .orderBy(desc(agentDocuments.updatedAt))
      .limit(50);
  };

  /** Lists bounded topic activity for nightly review context. */
  listTopicActivity = (options: ListAgentSignalTopicActivityOptions) => {
    const effectiveAgentId = sql<string>`COALESCE(${messages.agentId}, ${topics.agentId})`;

    return this.db
      .select({
        failedMessages: sql<AgentSignalFailedMessageSummary[]>`
          COALESCE(
            jsonb_agg(
              DISTINCT jsonb_build_object(
                'errorSummary', left(${messages.error}::text, 500),
                'messageId', ${messages.id}
              )
            ) FILTER (WHERE ${messages.error} IS NOT NULL),
            '[]'::jsonb
          )
        `,
        failedToolCalls: sql<AgentSignalFailedToolCallSummary[]>`
          COALESCE(
            jsonb_agg(
              DISTINCT jsonb_build_object(
                'apiName', ${messagePlugins.apiName},
                'errorSummary', left(${messagePlugins.error}::text, 500),
                'identifier', ${messagePlugins.identifier},
                'messageId', ${messages.id},
                'toolCallId', ${messagePlugins.toolCallId}
              )
            ) FILTER (WHERE ${messagePlugins.error} IS NOT NULL),
            '[]'::jsonb
          )
        `,
        failedToolCount:
          sql<number>`COUNT(${messagePlugins.id}) FILTER (WHERE ${messagePlugins.error} IS NOT NULL)`.mapWith(
            Number,
          ),
        failureCount:
          sql<number>`COUNT(${messages.id}) FILTER (WHERE ${messages.error} IS NOT NULL)`.mapWith(
            Number,
          ),
        lastActivityAt: sql<Date>`MAX(${messages.createdAt})`.mapWith(parseAggregateTimestamp),
        messageCount: count(messages.id),
        summary: sql<string>`COALESCE(${topics.historySummary}, ${topics.description}, ${topics.content}, '')`,
        title: topics.title,
        topicId: topics.id,
      })
      .from(messages)
      .leftJoin(topics, and(eq(topics.id, messages.topicId), eq(topics.userId, this.userId)))
      .leftJoin(
        messagePlugins,
        and(eq(messagePlugins.id, messages.id), eq(messagePlugins.userId, this.userId)),
      )
      .where(
        and(
          eq(messages.userId, this.userId),
          eq(effectiveAgentId, options.agentId),
          gte(messages.createdAt, options.windowStart),
          lte(messages.createdAt, options.windowEnd),
        ),
      )
      .groupBy(topics.id, topics.title, topics.historySummary, topics.description, topics.content)
      .orderBy(desc(sql`MAX(${messages.createdAt})`))
      .limit(options.limit);
  };

  /** Lists scoped topic activity for self-reflection review context. */
  listSelfReflectionTopicActivity = (options: ListAgentSignalSelfReflectionTopicOptions) => {
    return this.db
      .select({
        failedMessages: sql<AgentSignalFailedMessageSummary[]>`
          COALESCE(
            jsonb_agg(
              DISTINCT jsonb_build_object(
                'errorSummary', left(${messages.error}::text, 500),
                'messageId', ${messages.id}
              )
            ) FILTER (WHERE ${messages.error} IS NOT NULL),
            '[]'::jsonb
          )
        `,
        failedToolCalls: sql<AgentSignalFailedToolCallSummary[]>`
          COALESCE(
            jsonb_agg(
              DISTINCT jsonb_build_object(
                'apiName', ${messagePlugins.apiName},
                'errorSummary', left(${messagePlugins.error}::text, 500),
                'identifier', ${messagePlugins.identifier},
                'messageId', ${messages.id},
                'toolCallId', ${messagePlugins.toolCallId}
              )
            ) FILTER (WHERE ${messagePlugins.error} IS NOT NULL),
            '[]'::jsonb
          )
        `,
        failedToolCount:
          sql<number>`COUNT(${messagePlugins.id}) FILTER (WHERE ${messagePlugins.error} IS NOT NULL)`.mapWith(
            Number,
          ),
        failureCount:
          sql<number>`COUNT(${messages.id}) FILTER (WHERE ${messages.error} IS NOT NULL)`.mapWith(
            Number,
          ),
        lastActivityAt: sql<Date>`MAX(${messages.createdAt})`.mapWith(parseAggregateTimestamp),
        messageCount: count(messages.id),
        summary: sql<string>`COALESCE(${topics.historySummary}, ${topics.description}, ${topics.content}, '')`,
        title: topics.title,
        topicId: topics.id,
      })
      .from(messages)
      .leftJoin(topics, and(eq(topics.id, messages.topicId), eq(topics.userId, this.userId)))
      .leftJoin(
        messagePlugins,
        and(eq(messagePlugins.id, messages.id), eq(messagePlugins.userId, this.userId)),
      )
      .where(
        and(
          eq(messages.userId, this.userId),
          eq(messages.agentId, options.agentId),
          gte(messages.createdAt, options.windowStart),
          lte(messages.createdAt, options.windowEnd),
          eq(messages.topicId, options.topicId),
        ),
      )
      .groupBy(topics.id, topics.title, topics.historySummary, topics.description, topics.content)
      .limit(1);
  };
}
