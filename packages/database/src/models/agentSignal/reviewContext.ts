import { and, count, desc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';

import { agents, messagePlugins, messages, topics, userMemories } from '../../schemas';
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

export interface AgentSignalTopicActivityRow {
  failedToolCount: number;
  failureCount: number;
  lastActivityAt: Date | null;
  messageCount: number;
  summary: string;
  title: string | null;
  topicId: string | null;
}

export interface AgentSignalRelevantMemoryRow {
  content: string;
  id: string;
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

  /** Lists bounded topic activity for nightly review context. */
  listTopicActivity = (options: ListAgentSignalTopicActivityOptions) => {
    const effectiveAgentId = sql<string>`COALESCE(${messages.agentId}, ${topics.agentId})`;

    return this.db
      .select({
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
