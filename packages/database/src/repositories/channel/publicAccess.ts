import { and, desc, eq, isNull, notExists, sql } from 'drizzle-orm';

import { channelMembers, channels } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ilikeContains } from '../../utils/like';
import { notTrashed } from '../../utils/softDelete';
import { withDisplayTitles } from './displayTitle';
import { ChannelError } from './error';
import { memberInviterMetadata, requireWorkspaceMember } from './people';
import { audit, lockChannel } from './transaction';
import type { ChannelAccess } from './types';

/** Public group Channels in this workspace the caller has not joined, newest first. */
export const listJoinableChannels = async (
  db: LobeChatDatabase,
  userId: string,
  workspaceId: string | null,
  search?: string,
) => {
  if (!workspaceId) return [];
  const query = search?.trim();
  const rows = await db.transaction(async (tx) => {
    await requireWorkspaceMember(tx, workspaceId, userId);
    return tx
      .select({
        createdAt: channels.createdAt,
        id: channels.id,
        // Qualified by hand: a single-table select renders columns without their table.
        memberCount: sql<number>`(
          SELECT count(*)::int FROM channel_members m
          WHERE m.channel_id = "channels"."id" AND m.actor_type = 'user' AND m.status = 'active'
        )`,
        metadata: channels.metadata,
        projectId: channels.projectId,
        title: channels.title,
      })
      .from(channels)
      .where(
        and(
          eq(channels.workspaceId, workspaceId),
          eq(channels.visibility, 'public'),
          eq(channels.status, 'active'),
          isNull(channels.agentId),
          isNull(channels.peerUserId),
          notTrashed(channels.isDeleted),
          query ? ilikeContains(channels.title, query) : undefined,
          notExists(
            tx
              .select({ id: channelMembers.id })
              .from(channelMembers)
              .where(
                and(
                  eq(channelMembers.channelId, channels.id),
                  eq(channelMembers.userId, userId),
                  eq(channelMembers.status, 'active'),
                ),
              ),
          ),
        ),
      )
      .orderBy(desc(channels.createdAt))
      .limit(100);
  });
  // The metadata only marks a project's default Channel; it is not part of the browse item.
  return (await withDisplayTitles(db, rows)).map(({ metadata: _metadata, ...item }) => item);
};

/**
 * Joins a public group Channel of this workspace as a plain member. A person who left or was
 * removed can come back, the same as being added again.
 */
export const joinPublicChannel = async (
  db: LobeChatDatabase,
  userId: string,
  workspaceId: string | null,
  channelId: string,
): Promise<ChannelAccess> => {
  if (!workspaceId) throw new ChannelError('NOT_FOUND', 'Channel not found');
  return db.transaction(async (tx) => {
    await lockChannel(tx, channelId);
    const [channel] = await tx
      .select()
      .from(channels)
      .where(
        and(
          eq(channels.id, channelId),
          eq(channels.workspaceId, workspaceId),
          eq(channels.visibility, 'public'),
          isNull(channels.agentId),
          isNull(channels.peerUserId),
          notTrashed(channels.isDeleted),
        ),
      )
      .limit(1);
    // A private channel answers the same as a missing one, so its existence does not leak.
    if (!channel) throw new ChannelError('NOT_FOUND', 'Channel not found');
    if (channel.status === 'archived') throw new ChannelError('CONFLICT', 'Channel is archived');
    await requireWorkspaceMember(tx, workspaceId, userId);

    const [existing] = await tx
      .select()
      .from(channelMembers)
      .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)));
    if (existing?.status === 'active') return { channel, member: existing };
    // History is there to read, but it is not unread: a joiner starts caught up.
    const [member] = existing
      ? await tx
          .update(channelMembers)
          .set({
            lastReadSequence: channel.sequence,
            metadata: memberInviterMetadata(null),
            role: 'member',
            status: 'active',
          })
          .where(eq(channelMembers.id, existing.id))
          .returning()
      : await tx
          .insert(channelMembers)
          .values({
            actorType: 'user',
            channelId,
            lastReadSequence: channel.sequence,
            role: 'member',
            userId,
          })
          .returning();
    await audit(tx, channelId, 'member_joined', member.id, { userId });
    return { channel, member };
  });
};
