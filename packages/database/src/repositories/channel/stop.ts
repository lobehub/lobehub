import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { ChannelJobItem } from '../../schemas';
import { channelJobs, channelMessages } from '../../schemas';
import type { Transaction } from '../../type';
import { findThread } from './delivery';
import { audit } from './transaction';
import { OPEN_JOB_STATUSES } from './writer';

/** One job, or everything in a branch (`threadId: null` is the main channel). */
export type ChannelStopScope = { jobId: string } | { threadId: string | null };

/** What a stop decides on; a branch can hold many jobs, so their manifests are not loaded. */
const stopColumns = {
  claimed: sql<boolean>`${channelJobs.manifest} IS NOT NULL`,
  id: channelJobs.id,
  publicationRevoked: channelJobs.publicationRevoked,
  publishedMessageId: channelJobs.publishedMessageId,
  writerHeld: channelJobs.writerHeld,
};
interface StopCandidate {
  claimed: boolean;
  id: string;
  publicationRevoked: boolean;
  publishedMessageId: string | null;
  writerHeld: boolean;
}

/**
 * Cancels queued and running jobs in the scope and revokes the publication of every claimed
 * job that has not both published and released its writer. Pending routing in a branch is
 * closed and its attempt bumped, so a late Jev answer is ignored.
 *
 * `requester` narrows a branch stop to that member's own requests and pending routing; admins
 * stop the whole branch.
 *
 * Returns the jobs whose writer is still held: the caller must stop them physically, and
 * only that confirmation releases them.
 */
export const stopScope = async (
  tx: Transaction,
  channelId: string,
  scope: ChannelStopScope | { all: true },
  requester?: { memberId: string; userId: string },
): Promise<ChannelJobItem[]> => {
  let jobs: StopCandidate[];

  if ('jobId' in scope) {
    jobs = await tx
      .select(stopColumns)
      .from(channelJobs)
      .where(and(eq(channelJobs.channelId, channelId), eq(channelJobs.id, scope.jobId)));
  } else {
    if ('threadId' in scope) await findThread(tx, channelId, scope.threadId);
    const inBranch =
      'threadId' in scope
        ? scope.threadId
          ? eq(channelMessages.threadId, scope.threadId)
          : isNull(channelMessages.threadId)
        : undefined;
    await tx
      .update(channelMessages)
      .set({
        routingAttempt: sql`${channelMessages.routingAttempt} + 1`,
        routingReason: 'Stopped before routing finished',
        routingStatus: 'unassigned',
      })
      .where(
        and(
          eq(channelMessages.channelId, channelId),
          eq(channelMessages.routingStatus, 'pending'),
          inBranch,
          requester ? eq(channelMessages.userId, requester.userId) : undefined,
        ),
      );

    jobs = await tx
      .select(stopColumns)
      .from(channelJobs)
      .where(
        and(
          eq(channelJobs.channelId, channelId),
          'threadId' in scope
            ? scope.threadId
              ? eq(channelJobs.threadId, scope.threadId)
              : isNull(channelJobs.threadId)
            : undefined,
          requester ? eq(channelJobs.requesterMemberId, requester.memberId) : undefined,
        ),
      );
  }
  if (!jobs.length) return [];

  const jobIds = jobs.map((job) => job.id);
  const cancelled = await tx
    .update(channelJobs)
    .set({ status: 'cancelled' })
    .where(and(inArray(channelJobs.id, jobIds), inArray(channelJobs.status, OPEN_JOB_STATUSES)))
    .returning({ id: channelJobs.id });

  const revocable = jobs
    .filter(
      (job) =>
        job.claimed && !job.publicationRevoked && (!job.publishedMessageId || job.writerHeld),
    )
    .map((job) => job.id);
  if (revocable.length)
    await tx
      .update(channelJobs)
      .set({ publicationRevoked: true })
      .where(inArray(channelJobs.id, revocable));

  if (cancelled.length || revocable.length)
    await audit(tx, channelId, 'stop_requested', 'jobId' in scope ? scope.jobId : channelId, {
      jobs: cancelled.map((job) => job.id),
      revoked: revocable,
      threadId: 'threadId' in scope ? scope.threadId : null,
    });

  return tx
    .select()
    .from(channelJobs)
    .where(and(inArray(channelJobs.id, jobIds), eq(channelJobs.writerHeld, true)));
};
