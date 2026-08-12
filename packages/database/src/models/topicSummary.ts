import type { ChatTopicMetadata } from '@lobechat/types';
import {
  and,
  asc,
  eq,
  exists,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  max,
  ne,
  not,
  notExists,
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

// Mirrors `DEFAULT_TOPIC_AUTO_SUMMARY_SYSTEM_AGENT_ITEM.enabled`: users who have
// never touched the setting are opted out, so the missing-value default is false.
const isTopicAutoSummaryEnabled = sql<boolean>`COALESCE((${userSettings.systemAgent}->'topicAutoSummary'->>'enabled')::boolean, false) = true`;
const SYSTEM_TOPIC_TRIGGERS = ['cron', 'eval', 'task_manager', 'task', 'document'];

export const topicSummaryEligibleMessage = and(
  isNotNull(messages.content),
  ne(messages.content, ''),
  inArray(messages.role, ['assistant', 'user']),
);

const getAutoSummaryWatermark = () =>
  sql<Date>`COALESCE(NULLIF(COALESCE(${topics.metadata}->'autoSummary'->>'lastMessageUpdatedAt', ''), '')::timestamptz, 'epoch'::timestamptz)`.mapWith(
    topics.updatedAt,
  );

const mergeAutoSummaryMetadata = (marker: NonNullable<ChatTopicMetadata['autoSummary']>) =>
  sql`COALESCE(${topics.metadata}, '{}'::jsonb) || ${JSON.stringify({ autoSummary: marker })}::jsonb`;

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
    const lastMessageUpdatedAt = max(messages.updatedAt).mapWith(messages.updatedAt);
    const cursorCondition = cursor
      ? or(
          gt(lastMessageUpdatedAt, cursor.lastMessageUpdatedAt),
          and(eq(lastMessageUpdatedAt, cursor.lastMessageUpdatedAt), gt(topics.id, cursor.id)),
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
          topicSummaryEligibleMessage,
          or(isNull(topics.trigger), not(inArray(topics.trigger, SYSTEM_TOPIC_TRIGGERS))),
          or(isNull(topics.status), notInArray(topics.status, ['running', 'scheduled'])),
          force ? undefined : isTopicAutoSummaryEnabled,
        ),
      )
      .groupBy(topics.id, topics.userId, topics.workspaceId, topics.metadata)
      .having(
        and(
          lte(lastMessageUpdatedAt, idleBefore),
          force ? undefined : ne(getAutoSummaryWatermark(), lastMessageUpdatedAt),
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
    const snapshotMessage = this.db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.topicId, input.topicId),
          topicSummaryEligibleMessage,
          eq(messages.id, input.lastMessageId),
          eq(messages.updatedAt, input.lastMessageUpdatedAt),
        ),
      );
    const newerMessage = this.db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.topicId, input.topicId),
          topicSummaryEligibleMessage,
          or(
            gt(messages.updatedAt, input.lastMessageUpdatedAt),
            and(
              eq(messages.updatedAt, input.lastMessageUpdatedAt),
              gt(messages.id, input.lastMessageId),
            ),
          ),
        ),
      );

    const rows = await this.db
      .update(topics)
      .set({
        description: input.description,
        historySummary: input.summary,
        metadata: mergeAutoSummaryMetadata(marker),
        updatedAt: new Date(),
      })
      .where(and(eq(topics.id, input.topicId), exists(snapshotMessage), notExists(newerMessage)))
      .returning({ id: topics.id });

    return rows.length > 0;
  };
}
