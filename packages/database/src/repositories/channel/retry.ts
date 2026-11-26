import { channelMessageDeletedAt } from '@lobechat/types';
import { and, eq, inArray } from 'drizzle-orm';

import type { ChannelJobItem } from '../../schemas';
import { channelJobs, channelMessages } from '../../schemas';
import type { Transaction } from '../../type';
import { assertThreadOpen, findThread } from './delivery';
import { ChannelError } from './error';
import { audit } from './transaction';

/** How a failed reply runs again: from the start, or continuing the conversation it stopped in. */
export type ChannelRetryMode = 'resume' | 'retry';

/**
 * Queues a failed reply again, at the person's request. Only a reply that failed (never one that
 * was stopped, published or is still running) qualifies, only while its request still stands (a
 * deleted request leaves a tombstone without text or mentions, so re-running it would answer
 * nothing), and only once its writer is released, so two runs never hold the same reply.
 * Deliveries are unique per message and member, so the job itself goes back to the queue,
 * keeping its place in message order and its reply slot: the reply a later run publishes
 * replaces the failure's card. The next claim reads the Agent's current settings and environment
 * and opens a fresh operation; the failed one stays on its topic as history.
 *
 * - `retry` starts over, in whatever conversation a new request would get.
 * - `resume` keeps the failed run's topic (and with it a CLI Agent's session), so the next claim
 *   continues there when that topic is still usable for the same environment (see
 *   `resumableTopic`), with a short continuation prompt.
 *
 * Requests merged into the failed run go back with it, so the next claim merges them again.
 * `requesterMemberId` limits the retry to that member's own request; admins pass none.
 */
export const retryJob = async (
  tx: Transaction,
  channelId: string,
  jobId: string,
  mode: ChannelRetryMode = 'retry',
  requesterMemberId?: string,
): Promise<ChannelJobItem> => {
  const [row] = await tx
    .select({ job: channelJobs, request: channelMessages })
    .from(channelJobs)
    .innerJoin(channelMessages, eq(channelMessages.id, channelJobs.messageId))
    .where(and(eq(channelJobs.channelId, channelId), eq(channelJobs.id, jobId)));
  if (!row) throw new ChannelError('NOT_FOUND', 'Job not found');
  const { job, request } = row;
  if (requesterMemberId && job.requesterMemberId !== requesterMemberId)
    throw new ChannelError('FORBIDDEN', 'Only the requester or an admin can retry this job');
  // A withdrawn request must not restart work: the tombstone is left with no text or mentions,
  // and the coordinator would still launch a run for it.
  if (channelMessageDeletedAt(request.metadata))
    throw new ChannelError('CONFLICT', 'The request was deleted');
  assertThreadOpen(await findThread(tx, channelId, job.threadId));
  if (job.status !== 'failed' || job.publishedMessageId)
    throw new ChannelError('CONFLICT', 'Only a failed reply can be retried');
  if (job.writerHeld)
    throw new ChannelError('CONFLICT', 'The failed reply is still being released');
  const resume = mode === 'resume';
  if (resume && !job.topicId)
    throw new ChannelError('CONFLICT', 'The failed reply has no conversation to resume');

  const [retried] = await tx
    .update(channelJobs)
    .set({
      acceptedAt: null,
      blockedCode: null,
      blockedReason: null,
      claimedAt: null,
      deviceId: null,
      draft: null,
      // A resume keeps the failed run's topic and environment; the claim checks both again.
      ...(!resume && { executionConfig: null, topicId: null }),
      isolatedAt: null,
      leaseExpiresAt: null,
      leaseOwner: null,
      manifest: null,
      operationId: null,
      publicationRevoked: false,
      status: 'queued',
      workingDirectory: null,
    })
    .where(eq(channelJobs.id, job.id))
    .returning();
  // Requests merged into the failed run go back too, so the next claim merges them again.
  const merged = job.manifest?.requestMessageIds?.filter((id) => id !== job.messageId) ?? [];
  if (merged.length)
    await tx
      .update(channelJobs)
      .set({ status: 'queued' })
      .where(
        and(
          eq(channelJobs.channelId, channelId),
          eq(channelJobs.memberId, job.memberId),
          inArray(channelJobs.messageId, merged),
          eq(channelJobs.status, 'merged'),
        ),
      );
  await audit(tx, channelId, resume ? 'job_resumed' : 'job_retried', job.id, {
    operationId: job.operationId,
  });

  return retried;
};
