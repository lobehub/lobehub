import { and, eq, isNull, or, sql } from 'drizzle-orm';

import type { ChannelItem } from '../../schemas';
import { channelMembers, channels, userContacts } from '../../schemas';
import type { Transaction } from '../../type';
import { ChannelError } from './error';
import { requireWorkspaceMember } from './people';
import type { ChannelAccess } from './types';

/**
 * A personal conversation between two people exists only between contacts. Opening one and
 * sending in it both require the relation to still hold in both directions, so removing a
 * contact silences the conversation without deleting its history.
 */
export const requireMutualContacts = async (
  tx: Transaction,
  userId: string,
  peerUserId: string,
) => {
  const rows = await tx
    .select({ userId: userContacts.userId })
    .from(userContacts)
    .where(
      or(
        and(eq(userContacts.userId, userId), eq(userContacts.contactUserId, peerUserId)),
        and(eq(userContacts.userId, peerUserId), eq(userContacts.contactUserId, userId)),
      ),
    );
  if (rows.length < 2) throw new ChannelError('FORBIDDEN', 'You are not contacts');
};

/**
 * What lets two people talk one-on-one in a scope: in the personal space they must be mutual
 * contacts; in a workspace, both must still be its members. Checked on opening and on every send,
 * so removing a contact or leaving the workspace silences the conversation and keeps its history.
 */
export const requirePeerRelation = async (
  tx: Transaction,
  workspaceId: string | null,
  userId: string,
  peerUserId: string,
) => {
  if (!workspaceId) return requireMutualContacts(tx, userId, peerUserId);
  await requireWorkspaceMember(tx, workspaceId, userId);
  await requireWorkspaceMember(tx, workspaceId, peerUserId);
};

/** The other person of a conversation between two people, relative to `viewerId`. */
export const peerOf = (
  channel: Pick<ChannelItem, 'peerUserId' | 'userId'>,
  viewerId: string,
): string | null => {
  if (!channel.peerUserId) return null;
  return channel.userId === viewerId ? channel.peerUserId : channel.userId;
};

/** Transaction-scoped lock on the unordered pair in one scope, the same either way round. */
export const lockPeerPair = async (
  tx: Transaction,
  workspaceId: string | null,
  userId: string,
  peerUserId: string,
) => {
  const [a, b] = [userId, peerUserId].sort();
  const key = `channel-peer:${workspaceId ?? 'personal'}:${a}:${b}`;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
};

/** The pair's conversation in one scope, with the caller's membership; one exists per scope. */
export const findPeer = async (
  tx: Transaction,
  workspaceId: string | null,
  userId: string,
  peerUserId: string,
) => {
  const [row] = await tx
    .select({ channel: channels, member: channelMembers })
    .from(channels)
    .innerJoin(
      channelMembers,
      and(eq(channelMembers.channelId, channels.id), eq(channelMembers.userId, userId)),
    )
    .where(
      and(
        or(
          and(eq(channels.userId, userId), eq(channels.peerUserId, peerUserId)),
          and(eq(channels.userId, peerUserId), eq(channels.peerUserId, userId)),
        ),
        workspaceId ? eq(channels.workspaceId, workspaceId) : isNull(channels.workspaceId),
      ),
    )
    .limit(1);
  return row as ChannelAccess | undefined;
};
