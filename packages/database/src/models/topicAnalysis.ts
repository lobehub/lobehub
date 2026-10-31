import type { TopicAnalysisResult } from '@lobechat/types';
import { and, count, eq, isNull, lte, or, sql } from 'drizzle-orm';

import { messages, topicAnalyses, type TopicAnalysisItem, topics } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { notTrashed } from '../utils/softDelete';

/** The topic's own consumption at analysis time; `null` means not measured. */
export interface TopicUsageSnapshot {
  assistantMessages: number;
  llmCalls: number | null;
  toolCalls: number;
  topicModel: string | null;
  topicProvider: string | null;
  totalCost: number | null;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  totalTokens: number | null;
  userMessages: number;
}

export interface SaveTopicAnalysisParams {
  lastMessageId: string;
  lastMessageUpdatedAt: Date;
  result: TopicAnalysisResult;
  topicId: string;
  usage?: TopicUsageSnapshot;
}

/** Topic classifications owned by one user, scoped to a workspace when given. */
export class TopicAnalysisModel {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  /**
   * Insert the analysis, or replace the existing one for the same topic and
   * taxonomy version. An analysis of older messages never replaces a newer one,
   * so overlapping runs settle on the latest snapshot; returns `undefined` then.
   */
  save = async ({
    lastMessageId,
    lastMessageUpdatedAt,
    result,
    topicId,
    usage,
  }: SaveTopicAnalysisParams) => {
    const values = {
      ...usage,
      category: result.category,
      intent: result.intent ?? null,
      labels: result.labels ?? null,
      lastMessageId,
      lastMessageUpdatedAt,
      model: result.model,
      outcome: result.outcome ?? null,
      provider: result.provider,
      secondaryCategory: result.secondaryCategory ?? null,
    };

    const [row] = await this.db
      .insert(topicAnalyses)
      .values({
        ...values,
        taxonomyVersion: result.taxonomyVersion,
        topicId,
        userId: this.userId,
        workspaceId: this.workspaceId ?? null,
      })
      .onConflictDoUpdate({
        set: { ...values, updatedAt: new Date() },
        setWhere: or(
          isNull(topicAnalyses.lastMessageUpdatedAt),
          lte(topicAnalyses.lastMessageUpdatedAt, sql`excluded.last_message_updated_at`),
        ),
        target: [topicAnalyses.topicId, topicAnalyses.taxonomyVersion],
      })
      .returning();

    return row;
  };

  /**
   * Read the topic's rolled-up token and cost totals plus live message counts.
   * The topic is not re-checked for ownership: callers pass a topic they already
   * resolved for this user.
   */
  snapshotTopicUsage = async (topicId: string): Promise<TopicUsageSnapshot | undefined> => {
    const [topic] = await this.db
      .select({
        llmCalls: sql<number | null>`NULLIF(${topics.usage}->'llm'->>'apiCalls', '')::int`,
        topicModel: topics.model,
        topicProvider: topics.provider,
        totalCost: topics.totalCost,
        totalInputTokens: topics.totalInputTokens,
        totalOutputTokens: topics.totalOutputTokens,
        totalTokens: topics.totalTokens,
      })
      .from(topics)
      .where(eq(topics.id, topicId))
      .limit(1);
    if (!topic) return;

    const roleCounts = await this.db
      .select({ count: count(), role: messages.role })
      .from(messages)
      .where(and(eq(messages.topicId, topicId), notTrashed(messages.isDeleted)))
      .groupBy(messages.role);
    const countOf = (role: string) => roleCounts.find((row) => row.role === role)?.count ?? 0;

    return {
      ...topic,
      assistantMessages: countOf('assistant'),
      llmCalls: topic.llmCalls === null ? null : Number(topic.llmCalls),
      toolCalls: countOf('tool'),
      userMessages: countOf('user'),
    };
  };

  findByTopic = async (
    topicId: string,
    taxonomyVersion: string,
  ): Promise<TopicAnalysisItem | undefined> => {
    const [row] = await this.db
      .select()
      .from(topicAnalyses)
      .where(
        and(
          eq(topicAnalyses.topicId, topicId),
          eq(topicAnalyses.taxonomyVersion, taxonomyVersion),
          eq(topicAnalyses.userId, this.userId),
          this.workspaceId
            ? eq(topicAnalyses.workspaceId, this.workspaceId)
            : isNull(topicAnalyses.workspaceId),
        ),
      )
      .limit(1);

    return row;
  };
}
