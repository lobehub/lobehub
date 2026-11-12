import { and, eq, exists, isNotNull, isNull } from 'drizzle-orm';

import type { ChannelItem } from '../../schemas';
import { channelMembers, channels, projects } from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
import { buildWorkspaceWhere } from '../../utils/workspace';
import { ChannelError } from './error';
import { requireWorkspaceMember } from './people';
import { audit } from './transaction';
import type { ChannelAccess } from './types';

/**
 * A workspace project's group Channels are open to everyone who can read the project: they find
 * them in the project, read them, and become a member by joining or by sending. A private project
 * is readable by its creator only, so its Channels stay with their members. Personal scope has
 * no one else to open them to, so nothing is open there.
 */
export const openProjectChannelWhere = (
  db: LobeChatDatabase | Transaction,
  userId: string,
  workspaceId: string | null,
) =>
  workspaceId
    ? and(
        isNotNull(channels.projectId),
        isNull(channels.agentId),
        eq(channels.workspaceId, workspaceId),
        exists(
          db
            .select({ id: projects.id })
            .from(projects)
            .where(
              and(
                eq(projects.id, channels.projectId),
                buildWorkspaceWhere({ userId, workspaceId }, projects),
              ),
            ),
        ),
      )
    : undefined;

/**
 * Makes the caller an active member of an open project Channel. They have seen it before joining,
 * so it starts read; a member who left comes back, one removed by an admin does not.
 */
export const joinOpenChannel = async (
  tx: Transaction,
  channel: ChannelItem,
  userId: string,
): Promise<ChannelAccess> => {
  await requireWorkspaceMember(tx, channel.workspaceId!, userId);
  const [existing] = await tx
    .select()
    .from(channelMembers)
    .where(and(eq(channelMembers.channelId, channel.id), eq(channelMembers.userId, userId)));
  if (existing?.status === 'removed') throw new ChannelError('NOT_FOUND', 'Channel not found');
  const [member] = existing
    ? await tx
        .update(channelMembers)
        .set({ lastReadSequence: channel.sequence, role: 'member', status: 'active' })
        .where(eq(channelMembers.id, existing.id))
        .returning()
    : await tx
        .insert(channelMembers)
        .values({
          actorType: 'user',
          channelId: channel.id,
          lastReadSequence: channel.sequence,
          role: 'member',
          userId,
        })
        .returning();
  await audit(tx, channel.id, 'member_joined', member.id, { actorType: 'user', userId });
  return { channel, member };
};
