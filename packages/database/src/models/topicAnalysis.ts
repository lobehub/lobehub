import type { TopicAnalysisResult } from '@lobechat/types';
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';

import { topicAnalyses, type TopicAnalysisItem } from '../schemas';
import type { LobeChatDatabase } from '../type';

export interface SaveTopicAnalysisParams {
  lastMessageId: string;
  lastMessageUpdatedAt: Date;
  result: TopicAnalysisResult;
  topicId: string;
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
  }: SaveTopicAnalysisParams) => {
    const values = {
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
