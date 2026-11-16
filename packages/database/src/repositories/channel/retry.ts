import { and, eq, sql } from 'drizzle-orm';

import type { ChannelJobItem } from '../../schemas';
import { agentOperations, channelJobs } from '../../schemas';
import type { Transaction } from '../../type';
import { assertThreadOpen, findThread } from './delivery';
import { ChannelError } from './error';
import { audit } from './transaction';

/** The operation error type of a run whose device could not be reached. */
const DEVICE_UNREACHABLE = 'DeviceGatewayNotConfigured';

/**
 * Queues a reply that failed before it started again. Only a reply whose device could not be
 * reached qualifies, and only once its writer is released: nothing ran, nothing was accepted
 * or published, so running it again cannot repeat work. Deliveries are unique per message and
 * member, so the job itself goes back to the queue, keeping its place in message order. The
 * next claim reads the Agent's current settings and environment and opens a fresh operation;
 * the failed one stays on its topic as history.
 */
export const retryJob = async (
  tx: Transaction,
  channelId: string,
  jobId: string,
): Promise<ChannelJobItem> => {
  const [row] = await tx
    .select({ errorType: sql<string | null>`${agentOperations.error}->>'type'`, job: channelJobs })
    .from(channelJobs)
    .leftJoin(agentOperations, eq(agentOperations.id, channelJobs.operationId))
    .where(and(eq(channelJobs.channelId, channelId), eq(channelJobs.id, jobId)));
  if (!row) throw new ChannelError('NOT_FOUND', 'Job not found');
  const { errorType, job } = row;
  assertThreadOpen(await findThread(tx, channelId, job.threadId));
  if (
    job.status !== 'failed' ||
    errorType !== DEVICE_UNREACHABLE ||
    job.acceptedAt ||
    job.draft !== null ||
    job.publishedMessageId
  )
    throw new ChannelError(
      'CONFLICT',
      'Only a reply that could not reach its device can be retried',
    );
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
  await audit(tx, channelId, 'job_retried', job.id, { operationId: job.operationId });

  return retried;
};
