import type { ChannelThreadMention } from '@lobechat/types';
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';

import { channelMembers, channelMessages, channelThreads } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { notTrashed } from '../../utils/softDelete';

/**
 * The newest @mention of each member in each Thread of their Channel, keyed by Channel, however
 * the member's read position stands: opening the main conversation moves that position past
 * Thread messages nobody opened, so whether a Thread mention was seen is left to the client's
 * per-Thread reads. Older mentions are taken as seen, which keeps the scan to recent messages.
 * Trashed Threads are skipped: they can no longer be opened, so their mentions could never clear.
 */
export const channelThreadMentions = async (
  db: LobeChatDatabase,
  memberIds: string[],
): Promise<Map<string, ChannelThreadMention[]>> => {
  if (!memberIds.length) return new Map();

  const rows = await db
    .selectDistinctOn([channelMessages.channelId, channelMessages.threadId], {
      channelId: channelMessages.channelId,
      createdAt: channelMessages.createdAt,
      threadId: channelMessages.threadId,
    })
    .from(channelMessages)
    .innerJoin(channelMembers, eq(channelMembers.channelId, channelMessages.channelId))
    .innerJoin(
      channelThreads,
      and(
        eq(channelThreads.channelId, channelMessages.channelId),
        eq(channelThreads.id, channelMessages.threadId),
      ),
    )
    .where(
      and(
        inArray(channelMembers.id, memberIds),
        notTrashed(channelThreads.isDeleted),
        gt(channelMessages.createdAt, sql`now() - interval '30 days'`),
        sql`${channelMessages.mentions} @> jsonb_build_array(${channelMembers.id}::text)`,
      ),
    )
    .orderBy(channelMessages.channelId, channelMessages.threadId, desc(channelMessages.createdAt));

  const mentionsOf = new Map<string, ChannelThreadMention[]>();
  for (const { channelId, createdAt, threadId } of rows) {
    const mentions = mentionsOf.get(channelId) ?? [];
    mentions.push({ createdAt, threadId: threadId! });
    mentionsOf.set(channelId, mentions);
  }
  return mentionsOf;
};

/**
 * Unread messages, Threads included, that @mention each member, keyed by Channel and counted
 * from the member's read position, as `unreadCount` is.
 */
export const channelMentionCounts = async (
  db: LobeChatDatabase,
  memberIds: string[],
): Promise<Map<string, number>> => {
  if (!memberIds.length) return new Map();
  const rows = await db
    .select({ channelId: channelMessages.channelId, count: sql<number>`count(*)::int` })
    .from(channelMessages)
    .innerJoin(channelMembers, eq(channelMembers.channelId, channelMessages.channelId))
    .where(
      and(
        inArray(channelMembers.id, memberIds),
        sql`${channelMessages.sequence} > coalesce(${channelMembers.lastReadSequence}, 0)`,
        sql`${channelMessages.mentions} @> jsonb_build_array(${channelMembers.id}::text)`,
      ),
    )
    .groupBy(channelMessages.channelId);
  return new Map(rows.map(({ channelId, count }) => [channelId, count]));
};

/**
 * Unread messages for each member, keyed by Channel and counted from the member's read position:
 * the main conversation, plus Threads the member takes part in (follows, started, or has written
 * in), plus any message that @mentions them. Replies in other Threads are not news to the member,
 * so they neither raise the count nor, through it, a client's notification.
 */
export const channelUnreadCounts = async (
  db: LobeChatDatabase,
  memberIds: string[],
): Promise<Map<string, number>> => {
  if (!memberIds.length) return new Map();
  const rows = await db
    .select({ channelId: channelMessages.channelId, count: sql<number>`count(*)::int` })
    .from(channelMessages)
    .innerJoin(channelMembers, eq(channelMembers.channelId, channelMessages.channelId))
    .where(
      and(
        inArray(channelMembers.id, memberIds),
        sql`${channelMessages.sequence} > coalesce(${channelMembers.lastReadSequence}, 0)`,
        sql`(
          ${channelMessages.threadId} IS NULL
          OR ${channelMessages.mentions} @> jsonb_build_array(${channelMembers.id}::text)
          OR EXISTS (
            SELECT 1 FROM ${channelThreads} t
            WHERE t.channel_id = ${channelMessages.channelId}
              AND t.id = ${channelMessages.threadId}
              AND t.is_deleted IS NOT TRUE
              AND (
                t.follower_member_ids @> jsonb_build_array(${channelMembers.id}::text)
                OR (
                  ${channelMembers.userId} IS NOT NULL
                  AND EXISTS (
                    SELECT 1 FROM ${channelMessages} own
                    WHERE own.channel_id = t.channel_id
                      AND (own.id = t.root_message_id OR own.thread_id = t.id)
                      AND own.user_id = ${channelMembers.userId}
                  )
                )
              )
          )
        )`,
      ),
    )
    .groupBy(channelMessages.channelId);
  return new Map(rows.map(({ channelId, count }) => [channelId, count]));
};
