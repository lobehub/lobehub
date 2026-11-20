import type { ChannelMessageMetadata } from '@lobechat/types';
import { channelMessageDeletedAt } from '@lobechat/types';
import { and, eq, inArray, sql } from 'drizzle-orm';

import type { ChannelJobItem } from '../../schemas';
import { channelJobs, channelMessageFiles, channelMessages } from '../../schemas';
import type { Transaction } from '../../type';
import { assertThreadOpen, findThread } from './delivery';
import { ChannelError } from './error';
import { stopScope } from './stop';
import { audit } from './transaction';
import { OPEN_JOB_STATUSES } from './writer';

/**
 * Deletes a message: a person their own, an admin anyone's, Agent replies included. The row
 * stays as a tombstone (`metadata.deletedAt`) without text, mentions or attachments, so a Thread
 * started from it, replies quoting it and the jobs it asked for still resolve. Replies it asked
 * for that are still queued or running stop, and routing still deciding is closed.
 *
 * Returns the jobs whose writer is still held: the caller must stop them physically.
 */
const omitCard = (metadata: ChannelMessageMetadata | null) => {
  const { card: _card, ...rest } = metadata ?? {};
  return rest;
};

export const deleteMessage = async (
  tx: Transaction,
  channelId: string,
  caller: { admin: boolean; userId: string },
  messageId: string,
): Promise<ChannelJobItem[]> => {
  const [message] = await tx
    .select()
    .from(channelMessages)
    .where(and(eq(channelMessages.channelId, channelId), eq(channelMessages.id, messageId)));
  if (!message) throw new ChannelError('NOT_FOUND', 'Message not found');
  // Agent replies have no userId, so only an admin removes them.
  const own = message.routingStatus !== 'reply' && message.userId === caller.userId;
  if (!own && !caller.admin)
    throw new ChannelError('FORBIDDEN', 'Only the author or an admin can delete a message');
  if (channelMessageDeletedAt(message.metadata)) return [];
  assertThreadOpen(await findThread(tx, channelId, message.threadId));

  const open = await tx
    .select({ id: channelJobs.id })
    .from(channelJobs)
    .where(
      and(
        eq(channelJobs.channelId, channelId),
        eq(channelJobs.messageId, messageId),
        inArray(channelJobs.status, OPEN_JOB_STATUSES),
      ),
    );
  const writers: ChannelJobItem[] = [];
  for (const job of open) writers.push(...(await stopScope(tx, channelId, { jobId: job.id })));

  await tx
    .update(channelMessages)
    .set({
      content: '',
      mentions: [],
      // A shared card is the message's payload, so it goes with the text.
      metadata: { ...omitCard(message.metadata), deletedAt: new Date().toISOString() },
      // A late decision model answer must not route a deleted message.
      ...(message.routingStatus === 'pending' && {
        routingAttempt: sql`${channelMessages.routingAttempt} + 1`,
        routingReason: 'Deleted before routing finished',
        routingStatus: 'unassigned' as const,
      }),
    })
    .where(eq(channelMessages.id, messageId));
  await tx.delete(channelMessageFiles).where(eq(channelMessageFiles.messageId, messageId));
  await audit(tx, channelId, 'message_deleted', messageId);
  return writers;
};
