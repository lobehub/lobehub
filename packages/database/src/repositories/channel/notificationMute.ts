import { and, eq, sql } from 'drizzle-orm';

import { channelMembers } from '../../schemas';
import type { Transaction } from '../../type';

/**
 * Whether a person member turned off their own push notifications for the Channel, as SQL over
 * `channel_members`, so a notification query can leave them out. Only their pushes stop: they
 * still get every message, and Agents still reply (muting an Agent is `config.muted`).
 */
export const notificationsMutedSql = () =>
  sql<boolean>`coalesce((${channelMembers.metadata} ->> 'notificationsMuted')::boolean, false)`;

/**
 * Turns the caller's own push notifications for one Channel off or on. Kept in the member row's
 * metadata, not a column; the other metadata keys stay as they are.
 *
 * The predicate carries the caller's `userId` next to `memberId`, so this helper cannot rewrite
 * somebody else's row even if a future caller hands it a foreign member id; when no row matches it
 * fails closed instead of reporting a mute that never happened.
 */
export const setNotificationsMuted = async (
  tx: Transaction,
  caller: { memberId: string; userId: string },
  muted: boolean,
) => {
  const metadata = sql`coalesce(${channelMembers.metadata}, '{}'::jsonb)`;
  const [updated] = await tx
    .update(channelMembers)
    .set({
      metadata: muted
        ? sql`${metadata} || '{"notificationsMuted": true}'::jsonb`
        : sql`${metadata} - 'notificationsMuted'`,
    })
    .where(and(eq(channelMembers.id, caller.memberId), eq(channelMembers.userId, caller.userId)))
    .returning({ id: channelMembers.id });

  if (!updated) throw new Error('Channel member not found for this person');
  return muted;
};
