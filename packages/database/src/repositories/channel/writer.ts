import type { AgentOperationStatus } from '@lobechat/types';
import { and, eq, inArray } from 'drizzle-orm';

import type { ChannelJobItem } from '../../schemas';
import { agentOperations, channelJobs } from '../../schemas';
import type { Transaction } from '../../type';
import { audit } from './transaction';

/** Operation statuses a channel transition may still advance. */
export const LIVE_OPERATION_STATUSES: AgentOperationStatus[] = [
  'idle',
  'running',
  'waiting_for_async_tool',
  'waiting_for_client',
  'waiting_for_human',
];

/** Only in-flight operations can advance; runtime-owned metrics and trace remain untouched. */
export const advanceOperation = async (
  tx: Transaction,
  job: ChannelJobItem,
  status: AgentOperationStatus,
  error?: string,
) => {
  if (!job.operationId) return;

  await tx
    .update(agentOperations)
    .set({
      status,
      ...(status === 'running' ? { startedAt: new Date() } : { completedAt: new Date() }),
      ...(error && { error: { message: error } }),
    })
    .where(
      and(
        eq(agentOperations.id, job.operationId),
        inArray(agentOperations.status, LIVE_OPERATION_STATUSES),
      ),
    );
};

/** Current status of the job's operation, or undefined once the operation is gone. */
export const operationStatus = async (
  tx: Transaction,
  job: ChannelJobItem,
): Promise<AgentOperationStatus | undefined> => {
  if (!job.operationId) return;

  const [operation] = await tx
    .select({ status: agentOperations.status })
    .from(agentOperations)
    .where(eq(agentOperations.id, job.operationId));
  return operation?.status;
};

/** Job statuses a stop, failure or isolation still settles. */
export const OPEN_JOB_STATUSES = ['queued', 'running'] as const;

export const isOpenJob = (job: ChannelJobItem) =>
  (OPEN_JOB_STATUSES as readonly string[]).includes(job.status);

/**
 * Logically isolates a writer whose termination stayed unconfirmed (INC-049). Its
 * publication is revoked and an open job is settled as failed, so the member can run again.
 * It never claims the process stopped: `writerHeld` stays set until physical confirmation,
 * and the device directory stays locked until then.
 */
export const isolateWriter = async (tx: Transaction, job: ChannelJobItem, reason: string) => {
  if (!job.writerHeld || job.isolatedAt) return false;

  await tx
    .update(channelJobs)
    .set({
      isolatedAt: new Date(),
      publicationRevoked: true,
      ...(isOpenJob(job) && { status: 'failed' as const }),
    })
    .where(eq(channelJobs.id, job.id));
  await advanceOperation(tx, job, 'abandoned', reason);
  await audit(tx, job.channelId, 'execution_isolated', job.id, { reason, status: job.status });

  return true;
};
