import type { ChannelThreadMention } from '@lobechat/types';
import { and, desc, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';

import { channelMembers, channelMessages } from '../../schemas';
import type { LobeChatDatabase } from '../../type';

/**
 * The newest @mention of each member in each Thread of their Channel, keyed by Channel, however
 * the member's read position stands: opening the main conversation moves that position past
 * Thread messages nobody opened, so whether a Thread mention was seen is left to the client's
 * per-Thread reads. Older mentions are taken as seen, which keeps the scan to recent messages.
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
    .where(
      and(
        inArray(channelMembers.id, memberIds),
        isNotNull(channelMessages.threadId),
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
