import { and, eq, exists, isNotNull, isNull, notExists, sql } from 'drizzle-orm';

import type { ChannelItem } from '../../schemas';
import { channelMembers, channels, projects, workspaceMembers } from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
import { notTrashed } from '../../utils/softDelete';
import { buildWorkspaceWhere } from '../../utils/workspace';
import { ChannelError } from './error';
import { memberInviterMetadata, requireWorkspaceMember } from './people';
import { audit } from './transaction';
import type { ChannelAccess } from './types';
import { readChannelView, viewerJobs } from './view';

/**
 * A workspace project's group Channels are open to everyone who can read the project: they find
 * them in the project, read them, and become a member by joining or by sending. A private project
 * is readable by its creator only, so its Channels stay with their members. Personal scope has
 * no one else to open them to, so nothing is open there. Only active workspace members qualify:
 * the workspace header alone is not proof of membership in every runtime.
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
            .select({ userId: workspaceMembers.userId })
            .from(workspaceMembers)
            .where(
              and(
                eq(workspaceMembers.workspaceId, workspaceId),
                eq(workspaceMembers.userId, userId),
                isNull(workspaceMembers.deletedAt),
              ),
            ),
        ),
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

/** Open project Channels of this scope, minus the ones an admin removed the caller from. */
export const openChannelWhere = (
  db: LobeChatDatabase | Transaction,
  userId: string,
  workspaceId: string | null,
) => {
  const open = openProjectChannelWhere(db, userId, workspaceId);
  if (!open) return sql`false`;
  return and(
    open,
    notExists(
      db
        .select({ id: channelMembers.id })
        .from(channelMembers)
        .where(
          and(
            eq(channelMembers.channelId, channels.id),
            eq(channelMembers.userId, userId),
            eq(channelMembers.status, 'removed'),
          ),
        ),
    ),
  );
};

/** Trashed and archived open Channels stay with their members: newcomers neither read nor join. */
const activeOpenWhere = (
  db: LobeChatDatabase | Transaction,
  userId: string,
  workspaceId: string | null,
) =>
  and(
    openChannelWhere(db, userId, workspaceId),
    notTrashed(channels.isDeleted),
    eq(channels.status, 'active'),
  );

export const findOpenChannel = async (
  tx: Transaction,
  userId: string,
  workspaceId: string | null,
  channelId: string,
) => {
  const [channel] = await tx
    .select()
    .from(channels)
    .where(and(eq(channels.id, channelId), activeOpenWhere(tx, userId, workspaceId)))
    .limit(1);
  return channel;
};

/** Active open project Channels the caller has not joined, so the project can list them. */
export const listUnjoinedOpenChannels = async (
  db: LobeChatDatabase,
  userId: string,
  workspaceId: string | null,
) =>
  workspaceId
    ? db
        .select()
        .from(channels)
        .where(
          and(
            activeOpenWhere(db, userId, workspaceId),
            notExists(
              db
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
    : [];

/**
 * An active open project Channel read by someone who has not joined: read-only, no member
 * actions.
 */
export const readOpenChannel = async (
  db: LobeChatDatabase,
  userId: string,
  workspaceId: string | null,
  channelId: string,
  options?: Parameters<typeof readChannelView>[2],
) =>
  db.transaction(async (tx) => {
    const channel = await findOpenChannel(tx, userId, workspaceId, channelId);
    if (!channel) throw new ChannelError('NOT_FOUND', 'Channel not found');
    const view = await readChannelView(tx, channelId, options, userId);
    return {
      channel: { ...channel, canDelete: false },
      joined: false,
      ...view,
      jobs: viewerJobs(view.jobs, userId, () => false),
    };
  });

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
          channelId: channel.id,
          lastReadSequence: channel.sequence,
          role: 'member',
          userId,
        })
        .returning();
  await audit(tx, channel.id, 'member_joined', member.id, { actorType: 'user', userId });
  return { channel, member };
};
