import type { AgentOperationStatus } from '@lobechat/types';
import { and, eq, gte, inArray, min } from 'drizzle-orm';

import type { ChannelJobItem } from '../../schemas';
import { agentOperations, channelAudit, channelJobs } from '../../schemas';
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
  /** A bare message, or one with the category a client explains in the viewer's language. */
  error?: string | { message: string; type?: string },
) => {
  if (!job.operationId) return;

  await tx
    .update(agentOperations)
    .set({
      status,
      ...(status === 'running' ? { startedAt: new Date() } : { completedAt: new Date() }),
      ...(error && { error: typeof error === 'string' ? { message: error } : error }),
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

/** Audited when a stop revokes a claimed job's publication; its target is the job. */
export const PUBLICATION_REVOKED_EVENT = 'publication_revoked';

/**
 * Events that revoke a held writer's publication, each audited with the job as its target:
 * a stop (one job, or one revoked job of a branch stop), a failure, or a lost acknowledgement.
 */
const REVOCATION_EVENTS = [
  PUBLICATION_REVOKED_EVENT,
  'stop_requested',
  'execution_failed',
  'execution_unknown',
];

/**
 * When the job's current run was first revoked. A failure is audited again on every reconcile
 * pass, so the earliest event of this claim counts. Falls back to the claim for a revocation
 * audited before per-job events existed.
 */
const revokedAt = async (tx: Transaction, job: ChannelJobItem) => {
  const [first] = await tx
    .select({ at: min(channelAudit.createdAt) })
    .from(channelAudit)
    .where(
      and(
        eq(channelAudit.targetId, job.id),
        inArray(channelAudit.event, REVOCATION_EVENTS),
        job.claimedAt ? gte(channelAudit.createdAt, job.claimedAt) : undefined,
      ),
    );
  return first?.at ?? job.claimedAt;
};

/**
 * Isolates a revoked writer (stopped or failed) whose termination the device has not confirmed
 * `timeoutMs` after the revocation, so the member's queue moves on instead of waiting for a
 * device that may never answer. See {@link isolateWriter}: the directory stays locked and a late
 * confirmation still releases the writer. Returns whether it isolated the writer.
 */
export const isolateUnconfirmedStop = async (
  tx: Transaction,
  job: ChannelJobItem,
  timeoutMs: number,
  now = Date.now(),
) => {
  if (!job.writerHeld || job.isolatedAt || !job.publicationRevoked) return false;
  // A dispatcher still holding its lease may yet submit the run; wait until it settles or lapses.
  if (job.leaseExpiresAt && job.leaseExpiresAt.getTime() > now) return false;

  const since = await revokedAt(tx, job);
  if (!since || now - since.getTime() < timeoutMs) return false;

  return isolateWriter(tx, job, 'The run did not confirm it stopped in time');
};
