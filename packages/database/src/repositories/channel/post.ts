import type { ChannelMessageKind, ChannelMessageMetadata } from '@lobechat/types';
import { and, eq } from 'drizzle-orm';

import type { ChannelMessageItem } from '../../schemas';
import { channelMembers, channelMessages } from '../../schemas';
import type { Transaction } from '../../type';
import { appendMessage, findThread } from './delivery';
import { ChannelError } from './error';
import { audit } from './transaction';

export interface ChannelAgentPostInput {
  /** The Agent that wrote it; must be an active member of the Channel. */
  agentId: string;
  content: string;
  /** What the message is; its payload goes in `metadata.<kind>`. Default `text`. */
  kind?: ChannelMessageKind;
  metadata?: ChannelMessageMetadata;
  /** The message it answers, e.g. the request a run's question card belongs to. */
  replyToId?: string;
  /** Identity of what produced the post (e.g. the run). Posting it again returns the stored one. */
  requestKey: string;
  /** The Thread to post in; one that is gone or closed falls back to the main timeline. */
  threadId?: string | null;
}

/**
 * Posts a message an Agent wrote outside any Channel job — what it found after something
 * outside the Channel woke it — at the end of the main timeline or the given Thread. Stored like a published reply
 * that answers no request, so it reads as the Agent's and wakes no one.
 *
 * Expects the caller to hold the Channel lock.
 */
export const postAgentMessage = async (
  tx: Transaction,
  channelId: string,
  input: ChannelAgentPostInput,
): Promise<ChannelMessageItem> => {
  const [existing] = await tx
    .select()
    .from(channelMessages)
    .where(
      and(
        eq(channelMessages.channelId, channelId),
        eq(channelMessages.requestKey, input.requestKey),
      ),
    )
    .limit(1);
  if (existing) return existing;

  const [member] = await tx
    .select({ config: channelMembers.config, id: channelMembers.id })
    .from(channelMembers)
    .where(
      and(
        eq(channelMembers.channelId, channelId),
        eq(channelMembers.actorType, 'agent'),
        eq(channelMembers.agentId, input.agentId),
        eq(channelMembers.status, 'active'),
      ),
    )
    .limit(1);
  if (!member) throw new ChannelError('CONFLICT', 'The Agent is not a member of this Channel');
  if (member.config?.muted)
    throw new ChannelError('CONFLICT', 'The Agent is muted in this Channel');

  const thread = await findThread(tx, channelId, input.threadId);
  const message = await appendMessage(tx, {
    agentId: input.agentId,
    channelId,
    content: input.content,
    ...(input.kind && { kind: input.kind }),
    metadata: input.metadata ?? {},
    ...(input.replyToId && { replyToId: input.replyToId }),
    requestKey: input.requestKey,
    routingStatus: 'reply',
    threadId: thread?.status === 'archived' ? null : (thread?.id ?? null),
  });
  await audit(tx, channelId, 'agent_posted', member.id, { messageId: message.id });

  return message;
};
