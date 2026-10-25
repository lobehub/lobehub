import type { ChannelMessageRoutingStatus } from '@lobechat/types';
import { and, eq, sql } from 'drizzle-orm';

import type { ChannelMessageItem } from '../../schemas';
import { channelMembers, channelMessages } from '../../schemas';
import type { Transaction } from '../../type';
import { candidateAgents, deliver, findThread } from './delivery';
import { ChannelError } from './error';
import { audit } from './transaction';

export type ChannelRoutingDecision =
  | { memberIds: string[]; reason: string; status: 'assigned' }
  | { reason: string; status: Extract<ChannelMessageRoutingStatus, 'skipped' | 'unassigned'> };

const findMessage = async (tx: Transaction, channelId: string, messageId: string) => {
  const [message] = await tx
    .select()
    .from(channelMessages)
    .where(and(eq(channelMessages.channelId, channelId), eq(channelMessages.id, messageId)));
  if (!message) throw new ChannelError('NOT_FOUND', 'Message not found');

  return message;
};

/**
 * Writes back a Jev decision. Applies only while the message is still `pending` at the same
 * attempt, so a late answer can never overwrite a retry or a stop. Chosen members that are
 * no longer candidates are dropped. Returns false when the result was stale.
 */
export const resolveRouting = async (
  tx: Transaction,
  channelId: string,
  messageId: string,
  attempt: number,
  decision: ChannelRoutingDecision,
): Promise<boolean> => {
  const message = await findMessage(tx, channelId, messageId);
  if (message.routingStatus !== 'pending' || message.routingAttempt !== attempt) return false;

  const thread = await findThread(tx, channelId, message.threadId);
  const chosen =
    decision.status === 'assigned'
      ? (await candidateAgents(tx, channelId, thread)).filter((agent) =>
          decision.memberIds.includes(agent.id),
        )
      : [];
  const [requester] = message.userId
    ? await tx
        .select({ id: channelMembers.id })
        .from(channelMembers)
        .where(
          and(
            eq(channelMembers.channelId, channelId),
            eq(channelMembers.userId, message.userId),
            eq(channelMembers.actorType, 'user'),
            eq(channelMembers.active, true),
          ),
        )
    : [];
  const delivered = requester ? await deliver(tx, message, chosen, requester.id) : [];
  const status =
    decision.status === 'assigned' && !delivered.length ? 'unassigned' : decision.status;

  await tx
    .update(channelMessages)
    .set({
      recipientMemberIds: delivered,
      routingReason:
        delivered.length || decision.status !== 'assigned'
          ? decision.reason
          : requester
            ? 'Chosen Agents are no longer available'
            : 'The message sender is no longer available',
      routingSource: 'jev',
      routingStatus: status,
    })
    .where(eq(channelMessages.id, messageId));
  await audit(tx, channelId, 'routing_decided', messageId, {
    attempt,
    reason: decision.reason,
    recipients: delivered,
    status,
  });

  return true;
};

/** Sends an `unassigned` message back to Jev under a new attempt number. */
export const retryRouting = async (
  tx: Transaction,
  channelId: string,
  messageId: string,
): Promise<ChannelMessageItem> => {
  const message = await findMessage(tx, channelId, messageId);
  if (message.routingStatus !== 'unassigned')
    throw new ChannelError('CONFLICT', 'Only an unassigned message can be routed again');

  const [retried] = await tx
    .update(channelMessages)
    .set({
      routingAttempt: sql`${channelMessages.routingAttempt} + 1`,
      routingReason: null,
      routingSource: null,
      routingStatus: 'pending',
    })
    .where(eq(channelMessages.id, messageId))
    .returning();
  await audit(tx, channelId, 'routing_retried', messageId, { attempt: retried.routingAttempt });

  return { ...retried, content: message.content };
};
