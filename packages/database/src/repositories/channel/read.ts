import { eq, sql } from 'drizzle-orm';

import { channelMembers } from '../../schemas';
import type { Transaction } from '../../type';
import { findThread } from './delivery';
import type { ChannelAccess } from './types';

const readSequences = sql`${channelMembers.metadata} -> 'threadReadSequences'`;

/**
 * The caller's read position in one Thread, kept in `metadata.threadReadSequences`. Sequences
 * are channel-wide, so a Thread's position compares directly with its replies' sequences.
 */
export const threadReadSequence = (threadId: string) =>
  sql<number>`coalesce((${readSequences} ->> ${threadId}::text)::integer, 0)`;

/**
 * `channel_members.metadata` with the Thread's read position raised to `sequence`, never
 * lowered, in one statement: a slower device's older position cannot overwrite a newer one.
 */
export const raiseThreadRead = (threadId: string, sequence: number | ReturnType<typeof sql>) =>
  sql`jsonb_set(
    coalesce(${channelMembers.metadata}, '{}'::jsonb) || jsonb_build_object(
      'threadReadSequences',
      case when jsonb_typeof(${readSequences}) = 'object' then ${readSequences} else '{}'::jsonb end
    ),
    array['threadReadSequences', ${threadId}::text],
    to_jsonb(greatest(${threadReadSequence(threadId)}, (${sequence})::integer))
  )`;

/** Raises the caller's main-timeline read position; it only moves forward, never past the channel. */
export const readChannelUpTo = async (
  tx: Transaction,
  { channel, member }: ChannelAccess,
  sequence: number,
) => {
  const lastReadSequence = Math.max(
    member.lastReadSequence ?? 0,
    Math.min(sequence, channel.sequence),
  );
  await tx.update(channelMembers).set({ lastReadSequence }).where(eq(channelMembers.id, member.id));
  return lastReadSequence;
};

/**
 * Raises the caller's read position in one live Thread of the channel, so every device of theirs
 * sees the same unread state. Like the main timeline's, it never moves back or past the channel.
 */
export const readThreadUpTo = async (
  tx: Transaction,
  { channel, member }: ChannelAccess,
  threadId: string,
  sequence: number,
) => {
  await findThread(tx, channel.id, threadId);
  const [row] = await tx
    .update(channelMembers)
    .set({ metadata: raiseThreadRead(threadId, Math.min(sequence, channel.sequence)) })
    .where(eq(channelMembers.id, member.id))
    .returning({ sequence: threadReadSequence(threadId) });
  return row.sequence;
};
