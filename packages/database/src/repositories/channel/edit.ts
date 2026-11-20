import { channelMessageDeletedAt, channelMessageEditedAt } from '@lobechat/types';
import { and, count, eq } from 'drizzle-orm';

import { channelMessageFiles, channelMessages } from '../../schemas';
import type { Transaction } from '../../type';
import { assertThreadOpen, findThread } from './delivery';
import { ChannelError } from './error';
import { audit } from './transaction';

/**
 * Rewrites the text of a person's own message. Its mentions and routing stay as they were sent:
 * an edit corrects what members read and what later replies see as context, it does not ask
 * anyone again. The time of the latest edit is kept in `metadata.editedAt`.
 */
export const editMessage = async (
  tx: Transaction,
  channelId: string,
  userId: string,
  messageId: string,
  content: string,
): Promise<{ content: string; editedAt: Date | null; id: string }> => {
  const [message] = await tx
    .select()
    .from(channelMessages)
    .where(and(eq(channelMessages.channelId, channelId), eq(channelMessages.id, messageId)));
  if (!message) throw new ChannelError('NOT_FOUND', 'Message not found');
  // A tombstone carries no content by design; editing one would put it back.
  if (channelMessageDeletedAt(message.metadata))
    throw new ChannelError('CONFLICT', 'A deleted message cannot be edited');
  // Agent replies have no userId, so this also keeps them read-only.
  if (message.routingStatus === 'reply' || message.userId !== userId)
    throw new ChannelError('FORBIDDEN', 'Only the author can edit a message');
  assertThreadOpen(await findThread(tx, channelId, message.threadId));

  const next = content.trim();
  if (next === message.content)
    return { content: next, editedAt: channelMessageEditedAt(message.metadata), id: messageId };
  if (!next) {
    // Like sending, a message may be only attachments; one without them needs text.
    const [{ files }] = await tx
      .select({ files: count() })
      .from(channelMessageFiles)
      .where(eq(channelMessageFiles.messageId, messageId));
    if (!files) throw new ChannelError('BAD_REQUEST', 'A message needs text or attachments');
  }

  const editedAt = new Date();
  await tx
    .update(channelMessages)
    .set({
      content: next,
      metadata: { ...message.metadata, editedAt: editedAt.toISOString() },
    })
    .where(eq(channelMessages.id, messageId));
  await audit(tx, channelId, 'message_edited', messageId);
  return { content: next, editedAt, id: messageId };
};
