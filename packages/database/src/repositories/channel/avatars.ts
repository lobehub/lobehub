import type { ChannelAvatarMember } from '@lobechat/types';
import { and, asc, eq, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';

import { agents, channelMembers, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';

/** A list avatar pictures the caller plus this many other members. */
export const CHANNEL_AVATAR_MEMBERS = 3;

/**
 * The earliest active members of each Channel besides `userId`, for the list avatar. One
 * query for all Channels, capped per Channel, so a large Channel does not load every member.
 */
export const channelAvatarMembers = async (
  db: LobeChatDatabase,
  channelIds: string[],
  userId: string,
): Promise<Map<string, ChannelAvatarMember[]>> => {
  const result = new Map<string, ChannelAvatarMember[]>();
  if (!channelIds.length) return result;

  const ranked = db
    .select({
      actorType: channelMembers.actorType,
      avatar: sql<string | null>`coalesce(${agents.avatar}, ${users.avatar})`.as('avatar'),
      backgroundColor: sql<string | null>`${agents.backgroundColor}`.as('background_color'),
      channelId: channelMembers.channelId,
      id: sql<string>`coalesce(${channelMembers.agentId}, ${channelMembers.userId})`.as(
        'member_id',
      ),
      name: sql<string | null>`coalesce(
        nullif(${channelMembers.name}, ''),
        nullif(${agents.title}, ''),
        nullif(${users.fullName}, ''),
        ${users.username}
      )`.as('name'),
      rank: sql<number>`row_number() over (
        partition by ${channelMembers.channelId}
        order by ${channelMembers.createdAt}, ${channelMembers.id}
      )`.as('rank'),
    })
    .from(channelMembers)
    .leftJoin(agents, eq(agents.id, channelMembers.agentId))
    .leftJoin(users, eq(users.id, channelMembers.userId))
    .where(
      and(
        inArray(channelMembers.channelId, channelIds),
        eq(channelMembers.status, 'active'),
        or(isNull(channelMembers.userId), ne(channelMembers.userId, userId)),
      ),
    )
    .as('ranked');

  const rows = await db
    .select()
    .from(ranked)
    .where(lte(ranked.rank, CHANNEL_AVATAR_MEMBERS))
    .orderBy(asc(ranked.channelId), asc(ranked.rank));

  for (const { channelId, rank: _rank, ...member } of rows) {
    const members = result.get(channelId) ?? [];
    members.push(member);
    result.set(channelId, members);
  }
  return result;
};
