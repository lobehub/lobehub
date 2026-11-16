import { and, eq, or, sql } from 'drizzle-orm';

import type { ChannelItem } from '../../schemas';
import { userContacts } from '../../schemas';
import type { Transaction } from '../../type';
import { ChannelError } from './error';

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

/** The other person of a conversation between two people, relative to `viewerId`. */
export const peerOf = (
  channel: Pick<ChannelItem, 'peerUserId' | 'userId'>,
  viewerId: string,
): string | null => {
  if (!channel.peerUserId) return null;
  return channel.userId === viewerId ? channel.peerUserId : channel.userId;
};

/** Transaction-scoped lock on the unordered pair, the same either way round. */
export const lockPeerPair = async (tx: Transaction, userId: string, peerUserId: string) => {
  const [a, b] = [userId, peerUserId].sort();
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`channel-peer:${a}:${b}`}))`);
};
