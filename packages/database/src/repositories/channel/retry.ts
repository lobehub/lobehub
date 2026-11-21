import { channelMessageDeletedAt } from '@lobechat/types';
import { and, eq, sql } from 'drizzle-orm';

import type { ChannelJobItem } from '../../schemas';
import { agentOperations, channelJobs, channelMessages } from '../../schemas';
import type { Transaction } from '../../type';
import { assertThreadOpen, findThread } from './delivery';
import { ChannelError } from './error';
import { audit } from './transaction';

/**
 * Queues a failed reply again. Any terminal failure qualifies (an unreachable device, a model or
 * quota error, a timeout, an unknown execution), but only while:
 *
 * - nothing was published: a reply already in the timeline is never answered twice;
 * - its request still stands: a deleted request leaves a tombstone without text or mentions, so
 *   re-running it would answer nothing;
 * - its writer is released: termination was confirmed, so the failed run can no longer write.
 *
 * A run that got further may have done work (tool calls, a saved draft); the person asked for it
 * again, so that work is repeated, never resumed. Its unpublished draft is discarded, and late
 * callbacks of the failed operation cannot publish because the job no longer points at it.
 * Deliveries are unique per message and member, so the job itself goes back to the queue, keeping
 * its place in message order. The next claim reads the Agent's current settings and environment
 * and opens a fresh operation; the failed one stays on its topic as history. Retries are
 * serialized by the Channel lock: a second retry finds the job queued and is refused.
 */
export const retryJob = async (
  tx: Transaction,
  channelId: string,
  jobId: string,
): Promise<ChannelJobItem> => {
  const [row] = await tx
    .select({
      errorType: sql<string | null>`${agentOperations.error}->>'type'`,
      job: channelJobs,
      request: channelMessages,
    })
    .from(channelJobs)
    .innerJoin(channelMessages, eq(channelMessages.id, channelJobs.messageId))
    .leftJoin(agentOperations, eq(agentOperations.id, channelJobs.operationId))
    .where(and(eq(channelJobs.channelId, channelId), eq(channelJobs.id, jobId)));
  if (!row) throw new ChannelError('NOT_FOUND', 'Job not found');
  const { errorType, job, request } = row;
  // A withdrawn request must not restart work: the tombstone is left with no text or mentions,
  // and the coordinator would still launch a run for it.
  if (channelMessageDeletedAt(request.metadata))
    throw new ChannelError('CONFLICT', 'The request was deleted');
  assertThreadOpen(await findThread(tx, channelId, job.threadId));
  if (job.status !== 'failed' || job.publishedMessageId)
    throw new ChannelError('CONFLICT', 'Only a failed reply that was not published can be retried');
  if (job.writerHeld)
    throw new ChannelError('CONFLICT', 'The failed reply is still being released');

  const [retried] = await tx
    .update(channelJobs)
    .set({
      acceptedAt: null,
      blockedCode: null,
      blockedReason: null,
      claimedAt: null,
      deviceId: null,
      draft: null,
      executionConfig: null,
      isolatedAt: null,
      leaseExpiresAt: null,
      leaseOwner: null,
      manifest: null,
      operationId: null,
      publicationRevoked: false,
      status: 'queued',
      topicId: null,
      workingDirectory: null,
    })
    .where(eq(channelJobs.id, job.id))
    .returning();
  await audit(tx, channelId, 'job_retried', job.id, {
    errorType,
    operationId: job.operationId,
  });

  return retried;
};
