import { eq, sql } from 'drizzle-orm';

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
 */
export const setNotificationsMuted = async (tx: Transaction, memberId: string, muted: boolean) => {
  const metadata = sql`coalesce(${channelMembers.metadata}, '{}'::jsonb)`;
  await tx
    .update(channelMembers)
    .set({
      metadata: muted
        ? sql`${metadata} || '{"notificationsMuted": true}'::jsonb`
        : sql`${metadata} - 'notificationsMuted'`,
    })
    .where(eq(channelMembers.id, memberId));
  return muted;
};
