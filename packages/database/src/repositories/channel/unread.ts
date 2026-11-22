import { and, eq, inArray, like, type SQL, sql } from 'drizzle-orm';

import { channelMembers, channelMessages } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { OPENING_REQUEST_KEY_PREFIX } from './openingKey';

interface MemberRead {
  channel: { id: string; sequence: number };
  lastReadSequence: number | null;
  memberId: string;
}

/** Unread messages matching `filter` per Channel, past each member's read position. */
const countUnread = async (db: LobeChatDatabase, memberIds: string[], filter: SQL) => {
  if (!memberIds.length) return new Map<string, number>();
  const rows = await db
    .select({ channelId: channelMessages.channelId, count: sql<number>`count(*)::int` })
    .from(channelMessages)
    .innerJoin(channelMembers, eq(channelMembers.channelId, channelMessages.channelId))
    .where(
      and(
        inArray(channelMembers.id, memberIds),
        sql`${channelMessages.sequence} > coalesce(${channelMembers.lastReadSequence}, 0)`,
        filter,
      ),
    )
    .groupBy(channelMessages.channelId);
  return new Map(rows.map(({ channelId, count }) => [channelId, count]));
};

/**
 * Each Channel's unread count and unread @mentions of the caller, from the caller's read
 * position; only channels with unread messages are scanned. An Agent's acknowledgement before
 * its run is not news: it counts as read, so the badge waits for the answer instead of reading
 * as the work being done.
 */
export const channelUnreadCounts = async (db: LobeChatDatabase, reads: MemberRead[]) => {
  const memberIds = reads
    .filter(({ channel, lastReadSequence }) => channel.sequence > (lastReadSequence ?? 0))
    .map(({ memberId }) => memberId);
  const [mentions, acks] = await Promise.all([
    countUnread(
      db,
      memberIds,
      sql`${channelMessages.mentions} @> jsonb_build_array(${channelMembers.id}::text)`,
    ),
    countUnread(db, memberIds, like(channelMessages.requestKey, `${OPENING_REQUEST_KEY_PREFIX}%`)),
  ]);
  const unread = new Map(
    reads.map(({ channel, lastReadSequence }) => [
      channel.id,
      Math.max(0, channel.sequence - (lastReadSequence ?? 0) - (acks.get(channel.id) ?? 0)),
    ]),
  );
  return { mentions, unread };
};
