import type {
  AgentOperationStatus,
  ChannelContextMessage,
  ChannelJobStatus,
} from '@lobechat/types';
import { and, asc, desc, eq, gt, isNotNull, isNull, ne, or } from 'drizzle-orm';

import type { ChannelJobItem } from '../../schemas';
import {
  agentOperations,
  agents,
  channelJobs,
  channelMembers,
  channelMessages,
} from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
import type { ChannelClaim, ChannelClaimOptions } from './claim';
import { claimJob } from './claim';
import { appendMessage } from './delivery';
import { ChannelError } from './error';
import { readManifestMessages } from './manifest';
import type { ChannelRoutingDecision } from './routing';
import { resolveRouting } from './routing';
import type { ChannelStopScope } from './stop';
import { stopScope } from './stop';
import { audit, withChannelLock } from './transaction';
import { advanceOperation, isolateWriter, isOpenJob, operationStatus } from './writer';

/**
 * A claimed job under the channel lock. A revoked job may still record its termination
 * (`allowRevoked`) but never accept input or publish.
 *
 * A claim is recognized by its frozen manifest, not its operation reference: that reference is
 * cleared if the operation row is deleted, and the writer must stay releasable even then.
 */
const claimed = async (
  tx: Transaction,
  channelId: string,
  jobId: string,
  allowRevoked = false,
): Promise<ChannelJobItem> => {
  const [job] = await tx
    .select()
    .from(channelJobs)
    .where(
      and(
        eq(channelJobs.channelId, channelId),
        eq(channelJobs.id, jobId),
        isNotNull(channelJobs.manifest),
      ),
    );
  if (!job) throw new ChannelError('NOT_FOUND', 'Claimed job not found');
  if (!allowRevoked && job.publicationRevoked)
    throw new ChannelError('CONFLICT', 'Run authority was revoked');

  return job;
};

/**
 * How a job ends once its writer is physically released.
 *
 * - Published: completed.
 * - Failed (including an unknown execution or isolation): stays failed; nothing publishes. An
 *   unknown execution is never redelivered.
 * - Revoked (stopped or isolated): an open job is cancelled.
 * - Accepted draft not yet published: still running, so a retried publish can finish it.
 * - Anything else ended without a reply: failed.
 */
export const releaseOutcome = (
  job: ChannelJobItem,
): {
  error?: string;
  job?: Extract<ChannelJobStatus, 'cancelled' | 'failed'>;
  operation: AgentOperationStatus;
  revoke: boolean;
} => {
  if (job.publishedMessageId) return { operation: 'done', revoke: false };
  if (job.status === 'failed') return { job: 'failed', operation: 'error', revoke: true };
  if (job.publicationRevoked) return { job: 'cancelled', operation: 'interrupted', revoke: true };
  if (job.acceptedAt && job.draft !== null) return { operation: 'done', revoke: false };

  return {
    error: 'The run ended without a reply',
    job: 'failed',
    operation: 'error',
    revoke: true,
  };
};

/** Marks a lease taken from a dispatcher that never settled. See `revokeExpiredLease`. */
const REVOKED_LEASE_PREFIX = 'revoked:';

/** Unseen public messages a run receives ahead of its request; see `recentContext`. */
export const RECENT_CONTEXT_LIMIT = 5;

/**
 * Channel writes made by the system rather than by a person: the dispatcher, native
 * completion callbacks, device receipts and reconcile. Mutations lock the channel row
 * within a transaction, except lease-only heartbeats. Callers must authenticate the source
 * (job-scoped token, service credentials) before calling.
 */
export class ChannelExecutionRepository {
  constructor(private readonly db: LobeChatDatabase) {}

  /**
   * The dispatch call settled; no later work from that call can start a process. Only the
   * lease owner settles it: a dispatcher whose lease was revoked changes nothing.
   */
  finishDispatch = async (channelId: string, jobId: string, leaseOwner: string) =>
    withChannelLock(this.db, channelId, async (tx) => {
      const job = await claimed(tx, channelId, jobId, true);
      if (job.leaseOwner !== leaseOwner) return;
      await tx
        .update(channelJobs)
        .set({ leaseExpiresAt: null, leaseOwner: null })
        .where(eq(channelJobs.id, job.id));
    });

  /**
   * Takes dispatch authority from a dispatcher whose lease expired, e.g. a worker that
   * crashed before `finishDispatch`. The lease owner becomes a revocation marker, so the old
   * dispatcher can neither renew nor settle it, and later passes still know the dispatch
   * never settled: a late submission may yet reach the device. This never releases the
   * writer.
   *
   * - `live`: a dispatcher still holds an unexpired lease.
   * - `settled`: the dispatch call finished; its submission, if any, already happened.
   * - `revoked`: the dispatcher lost its lease before settling.
   */
  revokeExpiredLease = async (
    channelId: string,
    jobId: string,
  ): Promise<'live' | 'revoked' | 'settled'> =>
    withChannelLock(this.db, channelId, async (tx) => {
      const job = await claimed(tx, channelId, jobId, true);
      if (!job.leaseOwner) return 'settled';
      if (job.leaseOwner.startsWith(REVOKED_LEASE_PREFIX)) return 'revoked';
      if (job.leaseExpiresAt && job.leaseExpiresAt.getTime() > Date.now()) return 'live';
      await tx
        .update(channelJobs)
        .set({ leaseExpiresAt: null, leaseOwner: `${REVOKED_LEASE_PREFIX}${job.leaseOwner}` })
        .where(eq(channelJobs.id, job.id));
      await audit(tx, channelId, 'dispatch_lease_expired', job.id, {
        leaseOwner: job.leaseOwner,
      });
      return 'revoked';
    });

  /** Retire only an untouched reservation, racing recordStart on the operation row itself. */
  retireReservation = async (channelId: string, jobId: string) =>
    withChannelLock(this.db, channelId, async (tx) => {
      const job = await claimed(tx, channelId, jobId, true);
      if (!job.operationId || !job.writerHeld) return false;
      const status = job.publicationRevoked ? 'interrupted' : 'error';
      const [retired] = await tx
        .update(agentOperations)
        .set({ status, completedAt: new Date() })
        .where(and(eq(agentOperations.id, job.operationId), eq(agentOperations.status, 'idle')))
        .returning({ id: agentOperations.id });
      if (!retired) return false;
      await tx
        .update(channelJobs)
        .set({
          leaseExpiresAt: null,
          leaseOwner: null,
          publicationRevoked: true,
          status: job.publicationRevoked ? 'cancelled' : 'failed',
          writerHeld: false,
        })
        .where(eq(channelJobs.id, job.id));
      await audit(tx, channelId, 'reservation_retired', job.id, { status });
      return true;
    });

  /** Writes back a routing decision for `attempt`; false when the result is stale. */
  resolveRouting = async (
    channelId: string,
    messageId: string,
    attempt: number,
    decision: ChannelRoutingDecision,
  ) =>
    withChannelLock(this.db, channelId, (tx) =>
      resolveRouting(tx, channelId, messageId, attempt, decision),
    );

  /**
   * What one advance pass works on: in-flight jobs to settle, oldest first and bounded, and
   * the queue head of each member. Only a head can be claimed, so a member whose backlog is
   * blocked (offline device, pending approval) cannot crowd out the other members.
   */
  candidates = async (channelId: string, limit = 100) => {
    const [inFlight, heads] = await Promise.all([
      this.db
        .select()
        .from(channelJobs)
        .where(
          and(
            eq(channelJobs.channelId, channelId),
            or(
              eq(channelJobs.writerHeld, true),
              and(eq(channelJobs.status, 'running'), isNull(channelJobs.publishedMessageId)),
            ),
          ),
        )
        .orderBy(asc(channelJobs.createdAt))
        .limit(limit),
      this.db
        .selectDistinctOn([channelJobs.memberId], { job: channelJobs })
        .from(channelJobs)
        .innerJoin(channelMessages, eq(channelMessages.id, channelJobs.messageId))
        .where(and(eq(channelJobs.channelId, channelId), eq(channelJobs.status, 'queued')))
        // Same order as the head check in claimJob.
        .orderBy(channelJobs.memberId, asc(channelMessages.sequence), asc(channelJobs.createdAt)),
    ]);
    return {
      heads: heads
        .map(({ job }) => job)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
      inFlight,
    };
  };

  /** Starts a queued job; null when it cannot start now. See {@link claimJob}. */
  claim = async (
    channelId: string,
    jobId: string,
    options: ChannelClaimOptions,
  ): Promise<ChannelClaim | null> =>
    withChannelLock(this.db, channelId, (tx, channel) => claimJob(tx, channel, jobId, options));

  /**
   * The triggering request and its explicit quote; see `recentContext` for the rest. Reads
   * without the channel lock, since nothing at or before the cutoff changes after the claim.
   */
  input = async (channelId: string, jobId: string): Promise<ChannelContextMessage[]> => {
    const [job] = await this.db
      .select({ manifest: channelJobs.manifest })
      .from(channelJobs)
      .where(
        and(
          eq(channelJobs.channelId, channelId),
          eq(channelJobs.id, jobId),
          isNotNull(channelJobs.manifest),
        ),
      );
    if (!job?.manifest) throw new ChannelError('NOT_FOUND', 'Claimed job not found');

    const request = await readManifestMessages(this.db, channelId, job.manifest, {
      messageId: job.manifest.requestMessageId,
    });
    const replyToId = request[0]?.replyToId;
    if (!replyToId) return request;
    const quoted = await readManifestMessages(this.db, channelId, job.manifest, {
      messageId: replyToId,
    });
    return [...quoted, ...request];
  };

  /**
   * Public messages before the request that this run's topic has not seen, oldest first and
   * at most {@link RECENT_CONTEXT_LIMIT}: everything after the last request the topic accepted,
   * except the reply it published. A new topic has seen nothing, so it gets the latest
   * messages. Anything older stays behind the history tools.
   */
  recentContext = async (channelId: string, jobId: string): Promise<ChannelContextMessage[]> => {
    const [job] = await this.db
      .select({ manifest: channelJobs.manifest, topicId: channelJobs.topicId })
      .from(channelJobs)
      .where(
        and(
          eq(channelJobs.channelId, channelId),
          eq(channelJobs.id, jobId),
          isNotNull(channelJobs.manifest),
        ),
      );
    if (!job?.manifest) throw new ChannelError('NOT_FOUND', 'Claimed job not found');

    const [seen] = job.topicId
      ? await this.db
          .select({
            manifest: channelJobs.manifest,
            publishedMessageId: channelJobs.publishedMessageId,
          })
          .from(channelJobs)
          .where(
            and(
              eq(channelJobs.channelId, channelId),
              eq(channelJobs.topicId, job.topicId),
              ne(channelJobs.id, jobId),
              isNotNull(channelJobs.acceptedAt),
              isNotNull(channelJobs.manifest),
            ),
          )
          .orderBy(desc(channelJobs.claimedAt), desc(channelJobs.id))
          .limit(1)
      : [];
    const seenThrough = seen?.manifest?.cutoffSequence ?? 0;
    // One extra row absorbs the topic's own published reply.
    const messages = await readManifestMessages(this.db, channelId, job.manifest, {
      beforeSequence: job.manifest.cutoffSequence,
      limit: RECENT_CONTEXT_LIMIT + 1,
    });

    return messages
      .filter(({ id, sequence }) => sequence > seenThrough && id !== seen?.publishedMessageId)
      .slice(-RECENT_CONTEXT_LIMIT);
  };

  /** The runtime took the input; only now may the job publish. */
  accepted = async (channelId: string, jobId: string) =>
    withChannelLock(this.db, channelId, async (tx) => {
      const job = await claimed(tx, channelId, jobId);
      if (job.acceptedAt || !job.writerHeld || job.status !== 'running') return;

      await tx
        .update(channelJobs)
        .set({ acceptedAt: new Date() })
        .where(eq(channelJobs.id, job.id));

      await advanceOperation(tx, job, 'running');
      await audit(tx, channelId, 'input_accepted', job.id, {
        cutoff: job.manifest?.cutoffSequence ?? null,
      });
    });

  /** Stores the final answer. Immutable once saved, so a retry cannot change it. */
  saveDraft = async (channelId: string, jobId: string, content: string) =>
    withChannelLock(this.db, channelId, async (tx) => {
      const job = await claimed(tx, channelId, jobId);
      if (job.draft !== null) {
        if (job.draft !== content)
          throw new ChannelError('CONFLICT', 'The final draft is immutable');
        return;
      }
      await tx.update(channelJobs).set({ draft: content }).where(eq(channelJobs.id, job.id));
    });

  /**
   * Publishes the saved draft as the member's reply and completes the job. Idempotent: a
   * second call returns the same message id.
   */
  publish = async (channelId: string, jobId: string): Promise<string> =>
    withChannelLock(this.db, channelId, async (tx) => {
      const job = await claimed(tx, channelId, jobId);
      if (job.publishedMessageId) return job.publishedMessageId;
      if (job.draft === null || !job.acceptedAt)
        throw new ChannelError('CONFLICT', 'No accepted final draft');

      const [member] = await tx
        .select({ id: channelMembers.id })
        .from(channelMembers)
        .where(and(eq(channelMembers.id, job.memberId), eq(channelMembers.status, 'active')));
      if (!member) throw new ChannelError('CONFLICT', 'The member left the channel');

      // The member may have been rebound since claim; attribute the reply to its frozen Agent.
      const [sender] = await tx
        .select({ id: agents.id })
        .from(agents)
        .where(eq(agents.id, job.manifest!.self.agentId))
        .for('share');
      if (!sender) throw new ChannelError('CONFLICT', 'The replying Agent was deleted');

      const reply = await appendMessage(tx, {
        agentId: sender.id,
        channelId,
        content: job.draft,
        replyToId: job.messageId,
        requestKey: `job:${job.id}`,
        routingStatus: 'reply',
        threadId: job.threadId,
      });
      await tx
        .update(channelJobs)
        .set({ publishedMessageId: reply.id, status: 'completed' })
        .where(eq(channelJobs.id, job.id));
      await audit(tx, channelId, 'draft_published', job.id, { messageId: reply.id });

      return reply.id;
    });

  /**
   * Physical termination confirmed (process tree ended, or the native operation finished).
   * Releases the writer, and with it the member and the device directory; the only other
   * release is retiring an untouched operation reservation.
   * Settles the job and its operation by how the run ended; see {@link releaseOutcome}.
   */
  releaseWriter = async (channelId: string, jobId: string) =>
    withChannelLock(this.db, channelId, async (tx) => {
      const job = await claimed(tx, channelId, jobId, true);
      if (!job.writerHeld) return;

      const outcome = releaseOutcome(job);
      const status = outcome.job && isOpenJob(job) ? outcome.job : job.status;
      await tx
        .update(channelJobs)
        .set({
          leaseExpiresAt: null,
          leaseOwner: null,
          publicationRevoked: outcome.revoke || job.publicationRevoked,
          status,
          writerHeld: false,
        })
        .where(eq(channelJobs.id, job.id));
      await advanceOperation(tx, job, outcome.operation, outcome.error);
      await audit(tx, channelId, 'writer_released', job.id, { status });
    });

  /**
   * The run failed. Revokes its publication and fails its job unless it was already being
   * stopped. The writer stays held until termination is confirmed. A late failure after the
   * reply was published or the release settled the job changes nothing.
   */
  fail = async (channelId: string, jobId: string, failure: { message: string }) =>
    withChannelLock(this.db, channelId, async (tx) => {
      const job = await claimed(tx, channelId, jobId, true);
      if (job.publishedMessageId || (!job.writerHeld && job.status !== 'running')) return;
      if ((await operationStatus(tx, job)) === 'done') return;

      const stopping = job.status === 'cancelled';
      await tx
        .update(channelJobs)
        .set({
          publicationRevoked: true,
          ...(!stopping && isOpenJob(job) && { status: 'failed' as const }),
        })
        .where(eq(channelJobs.id, job.id));
      await advanceOperation(
        tx,
        job,
        stopping ? 'interrupted' : 'error',
        stopping ? undefined : failure.message,
      );
      await audit(tx, channelId, 'execution_failed', job.id, {
        message: failure.message,
      });
    });

  /**
   * Lost the acknowledgement: the runtime may or may not have the input. The verdict is kept on
   * the job, independent of whatever the runtime later records on the operation: publication
   * is revoked and an open job fails, never redelivered. The writer stays held until
   * termination is confirmed or it is isolated.
   */
  executionUnknown = async (channelId: string, jobId: string, message: string) =>
    withChannelLock(this.db, channelId, async (tx) => {
      const job = await claimed(tx, channelId, jobId, true);
      if (!job.writerHeld || job.publishedMessageId || job.status === 'failed') return;

      await tx
        .update(channelJobs)
        .set({
          publicationRevoked: true,
          ...(isOpenJob(job) && { status: 'failed' as const }),
        })
        .where(eq(channelJobs.id, job.id));
      await advanceOperation(tx, job, 'abandoned', message);
      await audit(tx, channelId, 'execution_unknown', job.id, { message });
    });

  /** Isolates a writer whose termination stayed unconfirmed. See {@link isolateWriter}. */
  isolate = async (channelId: string, jobId: string, reason: string) =>
    withChannelLock(this.db, channelId, async (tx) =>
      isolateWriter(tx, await claimed(tx, channelId, jobId, true), reason),
    );

  /** System-initiated stop, e.g. a budget or reconcile decision. See {@link stopScope}. */
  stop = async (channelId: string, scope: ChannelStopScope) =>
    withChannelLock(this.db, channelId, (tx) => stopScope(tx, channelId, scope));

  /**
   * Extends the lease of a live run. Touches only the job row and takes no channel lock, so
   * it cannot deadlock with channel writes. Returns false once the run lost its lease or
   * writer.
   */
  heartbeat = async (
    jobId: string,
    lease: { leaseMs: number; leaseOwner: string },
  ): Promise<boolean> => {
    const now = new Date();
    const renewed = await this.db
      .update(channelJobs)
      .set({ leaseExpiresAt: new Date(now.getTime() + lease.leaseMs) })
      .where(
        and(
          eq(channelJobs.id, jobId),
          eq(channelJobs.leaseOwner, lease.leaseOwner),
          eq(channelJobs.writerHeld, true),
          gt(channelJobs.leaseExpiresAt, now),
        ),
      )
      .returning({ id: channelJobs.id });

    return renewed.length > 0;
  };
}
