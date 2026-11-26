import { channelMessageDeletedAt, channelMessageReceipt, channelMessageVia } from '@lobechat/types';
import { and, asc, desc, eq, gt, inArray, isNull, lt, or } from 'drizzle-orm';

import type { ChannelJobItem, ChannelMessageItem } from '../../schemas';
import { channelJobs, channelMessages } from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
import { isAgentAuthored } from './author';
import { audit } from './transaction';

/** Most requests one run answers together; the rest wait for the next run. */
export const MAX_MERGED_REQUESTS = 10;

/**
 * Whether a queued job owes an answer that may be merged with the requester's next ones: a
 * person's own message the Agent must answer — addressed, or woken as a `mention` (a follow-up
 * window, its name in the text) — not a `followup` wake (it may stay silent), a deferred one
 * (it waits for another reply), an Agent's message, a relay for someone elsewhere or an answer
 * brought back.
 */
const isMergeable = (job: Pick<ChannelJobItem, 'wake'>, request: ChannelMessageItem) =>
  (!job.wake || (job.wake.kind !== 'followup' && !job.wake.afterMemberId)) &&
  !isAgentAuthored(request) &&
  !channelMessageVia(request.metadata) &&
  !channelMessageReceipt(request.metadata) &&
  !channelMessageDeletedAt(request.metadata);

/**
 * The requests queued right behind a head job that one run can answer with it: the same
 * person's owed answers from this member in this branch, in message order. Stops at the first
 * one that is not, and at an undecided message, which could yet queue another request between
 * them. Messages from others in between stay context, not requests.
 */
export const findMergeableRequests = async (
  tx: Transaction,
  job: ChannelJobItem,
  request: ChannelMessageItem,
): Promise<{ job: ChannelJobItem; request: ChannelMessageItem }[]> => {
  if (!isMergeable(job, request)) return [];

  // A Thread's requests may also be main-timeline messages continued into it, so an undecided
  // main-timeline message holds a Thread's batch back too.
  const [pendingRoute] = await tx
    .select({ sequence: channelMessages.sequence })
    .from(channelMessages)
    .where(
      and(
        eq(channelMessages.channelId, job.channelId),
        gt(channelMessages.sequence, request.sequence),
        eq(channelMessages.routingStatus, 'pending'),
        job.threadId
          ? or(eq(channelMessages.threadId, job.threadId), isNull(channelMessages.threadId))
          : isNull(channelMessages.threadId),
      ),
    )
    .orderBy(asc(channelMessages.sequence))
    .limit(1);

  const queued = await tx
    .select({ job: channelJobs, request: channelMessages })
    .from(channelJobs)
    .innerJoin(channelMessages, eq(channelMessages.id, channelJobs.messageId))
    .where(
      and(
        eq(channelJobs.channelId, job.channelId),
        eq(channelJobs.memberId, job.memberId),
        eq(channelJobs.status, 'queued'),
        job.threadId ? eq(channelJobs.threadId, job.threadId) : isNull(channelJobs.threadId),
        gt(channelMessages.sequence, request.sequence),
        pendingRoute ? lt(channelMessages.sequence, pendingRoute.sequence) : undefined,
      ),
    )
    .orderBy(asc(channelMessages.sequence), asc(channelJobs.createdAt))
    .limit(MAX_MERGED_REQUESTS - 1);

  const mergeable: typeof queued = [];
  for (const next of queued) {
    if (
      next.job.requesterMemberId !== job.requesterMemberId ||
      next.request.userId !== request.userId ||
      !isMergeable(next.job, next.request)
    )
      break;
    mergeable.push(next);
  }
  return mergeable;
};

/**
 * Whether a queued job will be answered by an earlier one's run: the queued job right before it
 * from this member in this branch is the same person's owed answer. Such a job opens no reply
 * of its own; the run that answers it does.
 */
export const isMergedBehind = async (
  db: LobeChatDatabase | Transaction,
  job: ChannelJobItem,
  request: ChannelMessageItem,
) => {
  if (!isMergeable(job, request)) return false;

  const [previous] = await db
    .select({ job: channelJobs, request: channelMessages })
    .from(channelJobs)
    .innerJoin(channelMessages, eq(channelMessages.id, channelJobs.messageId))
    .where(
      and(
        eq(channelJobs.channelId, job.channelId),
        eq(channelJobs.memberId, job.memberId),
        eq(channelJobs.status, 'queued'),
        job.threadId ? eq(channelJobs.threadId, job.threadId) : isNull(channelJobs.threadId),
        lt(channelMessages.sequence, request.sequence),
      ),
    )
    .orderBy(desc(channelMessages.sequence))
    .limit(1);

  return (
    !!previous &&
    previous.job.requesterMemberId === job.requesterMemberId &&
    previous.request.userId === request.userId &&
    isMergeable(previous.job, previous.request)
  );
};

/** Settles queued jobs whose requests the claimed job answers in its own run. */
export const mergeJobs = async (tx: Transaction, into: ChannelJobItem, jobIds: string[]) => {
  if (!jobIds.length) return;

  await tx
    .update(channelJobs)
    .set({ blockedCode: null, blockedReason: null, deviceId: null, status: 'merged' })
    .where(and(inArray(channelJobs.id, jobIds), eq(channelJobs.status, 'queued')));
  await audit(tx, into.channelId, 'jobs_merged', into.id, { jobs: jobIds });
};
