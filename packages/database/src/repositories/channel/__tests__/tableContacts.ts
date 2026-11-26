import { and, eq, isNull, or, sql } from 'drizzle-orm';

import { userContacts, users } from '../../../schemas';
import type { ChannelContacts } from '../contacts';
import { ChannelError } from '../error';

/**
 * Test contacts read from `user_contacts` rows the test inserts: two people are contacts in a scope
 * when both directions exist there. A card snapshots any existing person: whether the sender may
 * share them is the address book's rule, tested with it.
 */
export const tableContacts: ChannelContacts = {
  areMutualContacts: async (tx, workspaceId, userId, peerUserId) => {
    const rows = await tx
      .select({ userId: userContacts.userId })
      .from(userContacts)
      .where(
        and(
          eq(userContacts.type, 'user'),
          workspaceId
            ? eq(userContacts.workspaceId, workspaceId)
            : isNull(userContacts.workspaceId),
          or(
            and(eq(userContacts.userId, userId), eq(userContacts.contactUserId, peerUserId)),
            and(eq(userContacts.userId, peerUserId), eq(userContacts.contactUserId, userId)),
          ),
        ),
      );
    return rows.length >= 2;
  },
  mutualPersonalContactWhere: (userId, contactUserId) => {
    const side = (from: unknown, to: unknown) =>
      sql`exists (select 1 from ${userContacts} where ${userContacts.type} = 'user' and ${userContacts.workspaceId} is null and ${userContacts.userId} = ${from} and ${userContacts.contactUserId} = ${to})`;
    return and(side(userId, contactUserId), side(contactUserId, userId))!;
  },
  resolveCard: async (tx, _userId, _workspaceId, input) => {
    if (input.type !== 'user') throw new ChannelError('FORBIDDEN', 'Share only your contacts');
    const [user] = await tx.select().from(users).where(eq(users.id, input.userId)).limit(1);
    if (!user) throw new ChannelError('FORBIDDEN', 'Share only your contacts');
    return {
      avatar: user.avatar,
      name: user.fullName || user.username || user.id,
      type: 'user',
      userId: user.id,
      username: user.username,
    };
  },
};
