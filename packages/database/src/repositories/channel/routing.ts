import type { ChannelAuditDetails, ChannelMessageRoutingStatus } from '@lobechat/types';
import { and, eq, sql } from 'drizzle-orm';

import type { ChannelMessageItem } from '../../schemas';
import { channelMembers, channelMessages, channelThreads } from '../../schemas';
import type { Transaction } from '../../type';
import { notTrashed } from '../../utils/softDelete';
import { assertThreadOpen, candidateAgents, deliver, findThread } from './delivery';
import { ChannelError } from './error';
import { audit } from './transaction';

export type ChannelRoutingDecision = (
  | { memberIds: string[]; reason: string; status: 'assigned' }
  | { reason: string; status: Extract<ChannelMessageRoutingStatus, 'skipped' | 'unassigned'> }
) & { details?: ChannelAuditDetails };

const findMessage = async (tx: Transaction, channelId: string, messageId: string) => {
  const [message] = await tx
    .select()
    .from(channelMessages)
    .where(and(eq(channelMessages.channelId, channelId), eq(channelMessages.id, messageId)));
  if (!message) throw new ChannelError('NOT_FOUND', 'Message not found');

  return message;
};

/**
 * Writes back a routing decision. Applies only while the message is still `pending` at the same
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
            eq(channelMembers.status, 'active'),
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
      routingSource: message.routingSource === 'fallback' ? 'fallback' : 'decision',
      routingStatus: status,
    })
    .where(eq(channelMessages.id, messageId));
  if (!message.threadId && delivered.length) {
    // Branches opened before this decision could not inherit its responders yet.
    // Keep members explicitly invited into those branches while routing was pending.
    const threads = await tx
      .select()
      .from(channelThreads)
      .where(
        and(
          eq(channelThreads.channelId, channelId),
          eq(channelThreads.rootMessageId, messageId),
          notTrashed(channelThreads.isDeleted),
        ),
      );
    for (const branch of threads)
      await tx
        .update(channelThreads)
        .set({ followerMemberIds: [...new Set([...branch.followerMemberIds, ...delivered])] })
        .where(eq(channelThreads.id, branch.id));
  }
  await audit(tx, channelId, 'routing_decided', messageId, {
    ...decision.details,
    attempt,
    reason: decision.reason,
    recipients: delivered,
    status,
  });

  return true;
};

/** Sends an `unassigned` message back to the decision model under a new attempt number. */
export const retryRouting = async (
  tx: Transaction,
  channelId: string,
  messageId: string,
): Promise<ChannelMessageItem> => {
  const message = await findMessage(tx, channelId, messageId);
  assertThreadOpen(await findThread(tx, channelId, message.threadId));
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
