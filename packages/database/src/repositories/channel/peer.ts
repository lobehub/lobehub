import { and, eq, isNull, or, sql } from 'drizzle-orm';

import type { ChannelItem } from '../../schemas';
import { channelMembers, channels, workspaceMembers } from '../../schemas';
import type { Transaction } from '../../type';
import type { ChannelContacts } from './contacts';
import { ChannelError } from './error';
import type { ChannelAccess } from './types';

/** Whether `userId` is an active member of the workspace. */
export const isWorkspaceMember = async (tx: Transaction, workspaceId: string, userId: string) => {
  const [member] = await tx
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
        isNull(workspaceMembers.deletedAt),
      ),
    )
    .for('share');
  return !!member;
};

/**
 * What lets two people talk one-on-one in a scope: in the personal space they must be mutual
 * contacts. In a workspace both are its members, or one is a member still paired with the other,
 * an external contact. Checked on opening and on every send, so removing a contact, closing to an
 * external contact or leaving the workspace silences the conversation and keeps its history.
 */
export const requirePeerRelation = async (
  tx: Transaction,
  contacts: ChannelContacts,
  workspaceId: string | null,
  userId: string,
  peerUserId: string,
) => {
  if (!workspaceId) {
    if (!(await contacts.areMutualContacts(tx, null, userId, peerUserId)))
      throw new ChannelError('FORBIDDEN', 'You are not contacts');
    return;
  }
  const [userIsMember, peerIsMember] = [
    await isWorkspaceMember(tx, workspaceId, userId),
    await isWorkspaceMember(tx, workspaceId, peerUserId),
  ];
  if (userIsMember && peerIsMember) return;
  // An external contact talks only with the members paired with them, never another outsider.
  if (
    (userIsMember || peerIsMember) &&
    (await contacts.areMutualContacts(tx, workspaceId, userId, peerUserId))
  )
    return;
  throw new ChannelError('NOT_FOUND', 'Workspace member not found');
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

/**
 * Opens the pair's conversation, or finds the one that exists, trashed or not. Both people join
 * it; whoever opens it first owns it.
 */
export const openPeerConversation = async (
  tx: Transaction,
  contacts: ChannelContacts,
  {
    peerUserId,
    title,
    userId,
    workspaceId,
  }: { peerUserId: string; title: string; userId: string; workspaceId: string | null },
): Promise<ChannelAccess> => {
  if (peerUserId === userId) throw new ChannelError('BAD_REQUEST', 'You cannot message yourself');
  await requirePeerRelation(tx, contacts, workspaceId, userId, peerUserId);
  // No unique index keeps one conversation per pair: serialize opening it, so two people
  // opening it at once (or one twice) find the first one instead of creating a second.
  await lockPeerPair(tx, workspaceId, userId, peerUserId);
  const existing = await findPeer(tx, workspaceId, userId, peerUserId);
  if (existing) return existing;

  const [channel] = await tx
    .insert(channels)
    .values({ peerUserId, title, userId, visibility: 'private', workspaceId })
    .returning();
  const [member] = await tx
    .insert(channelMembers)
    .values({
      actorType: 'user',
      channelId: channel.id,
      lastReadSequence: 0,
      role: 'owner',
      userId,
    })
    .returning();
  await tx.insert(channelMembers).values({
    actorType: 'user',
    channelId: channel.id,
    lastReadSequence: 0,
    role: 'owner',
    userId: peerUserId,
  });
  return { channel, member };
};
