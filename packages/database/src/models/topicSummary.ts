import type { ChatTopicMetadata } from '@lobechat/types';
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';

import { messages, topics, userSettings } from '../schemas';
import type { LobeChatDatabase } from '../type';

export interface TopicSummaryCandidateCursor {
  id: string;
  lastMessageUpdatedAt: Date;
}

export interface ListTopicSummaryCandidatesOptions {
  cursor?: TopicSummaryCandidateCursor;
  force?: boolean;
  idleBefore: Date;
  limit: number;
  topicCreatedAfter: Date;
}

export interface TopicSummaryCandidate {
  id: string;
  lastMessageUpdatedAt: Date;
  userId: string;
  workspaceId: string | null;
}

/** System-scoped queries used only by the authenticated background summary workflow. */
export class TopicSummaryModel {
  constructor(private readonly db: LobeChatDatabase) {}

  listCandidates = async ({
    cursor,
    force = false,
    idleBefore,
    limit,
    topicCreatedAfter,
  }: ListTopicSummaryCandidatesOptions): Promise<TopicSummaryCandidate[]> => {
    const lastMessageUpdatedAt = sql<Date>`max(${messages.updatedAt})`.mapWith(messages.updatedAt);
    const cursorCondition = cursor
      ? or(
          sql`${lastMessageUpdatedAt} > ${cursor.lastMessageUpdatedAt}`,
          and(
            sql`${lastMessageUpdatedAt} = ${cursor.lastMessageUpdatedAt}`,
            sql`${topics.id} > ${cursor.id}`,
          ),
        )
      : undefined;

    return this.db
      .select({
        id: topics.id,
        lastMessageUpdatedAt,
        userId: topics.userId,
        workspaceId: topics.workspaceId,
      })
      .from(topics)
      .innerJoin(messages, eq(messages.topicId, topics.id))
      .leftJoin(userSettings, eq(userSettings.id, topics.userId))
      .where(
        and(
          gte(topics.createdAt, topicCreatedAfter),
          isNotNull(messages.content),
          ne(messages.content, ''),
          inArray(messages.role, ['assistant', 'user']),
          or(isNull(topics.status), notInArray(topics.status, ['running', 'scheduled'])),
          force
            ? undefined
            : sql`COALESCE((${userSettings.systemAgent}->'topicAutoSummary'->>'enabled')::boolean, true) = true`,
        ),
      )
      .groupBy(
        topics.id,
        topics.userId,
        topics.workspaceId,
        topics.metadata,
        userSettings.systemAgent,
      )
      .having(
        and(
          lte(lastMessageUpdatedAt, idleBefore),
          force
            ? undefined
            : sql`COALESCE(NULLIF(COALESCE(${topics.metadata}->'autoSummary'->>'lastMessageUpdatedAt', ''), '')::timestamptz, 'epoch'::timestamptz) <> ${lastMessageUpdatedAt}`,
          cursorCondition,
        ),
      )
      .orderBy(asc(lastMessageUpdatedAt), asc(topics.id))
      .limit(limit);
  };

  updateSummaryIfCurrent = async (input: {
    description: string;
    lastMessageId: string;
    lastMessageUpdatedAt: Date;
    summary: string;
    topicId: string;
  }): Promise<boolean> => {
    const marker: NonNullable<ChatTopicMetadata['autoSummary']> = {
      lastMessageId: input.lastMessageId,
      lastMessageUpdatedAt: input.lastMessageUpdatedAt.toISOString(),
      summarizedAt: new Date().toISOString(),
      version: 1,
    };

    const rows = await this.db
      .update(topics)
      .set({
        description: input.description,
        historySummary: input.summary,
        metadata: sql`COALESCE(${topics.metadata}, '{}'::jsonb) || ${JSON.stringify({ autoSummary: marker })}::jsonb`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(topics.id, input.topicId),
          sql`EXISTS (
            SELECT 1 FROM ${messages}
            WHERE ${messages.topicId} = ${input.topicId}
              AND ${messages.id} = ${input.lastMessageId}
              AND ${messages.updatedAt} = ${input.lastMessageUpdatedAt}
          )`,
          sql`NOT EXISTS (
            SELECT 1 FROM ${messages}
            WHERE ${messages.topicId} = ${input.topicId}
              AND (
                ${messages.updatedAt} > ${input.lastMessageUpdatedAt}
                OR (
                  ${messages.updatedAt} = ${input.lastMessageUpdatedAt}
                  AND ${messages.id} > ${input.lastMessageId}
                )
              )
          )`,
        ),
      )
      .returning({ id: topics.id });

    return rows.length > 0;
  };
}
