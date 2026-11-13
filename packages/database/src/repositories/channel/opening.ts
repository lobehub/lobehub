import type { ChannelContextMessage } from '@lobechat/types';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import {
  agents,
  channelAudit,
  channelJobs,
  channelMembers,
  channelMessages,
  channels,
  channelThreads,
} from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
import { notTrashed } from '../../utils/softDelete';
import { appendMessage } from './delivery';
import { readManifestMessages } from './manifest';
import { audit, withChannelLock } from './transaction';
import { createChannelThread } from './view';

/** Audit event that marks a job's reply as opened; a job opens at most once. */
export const REPLY_OPENED_EVENT = 'reply_opened';

/** Longest stored thread title, the same bound the bot opener uses. */
const THREAD_TITLE_LENGTH = 60;

/** Messages before the request the opener sees, oldest first. */
const OPENING_CONTEXT_LIMIT = 6;

/** Request key of the acknowledgement a job posted before its run. */
export const openingRequestKey = (jobId: string) => `opening:${jobId}`;

/** A queued job that may still open its reply, with what the opener needs to decide. */
export interface ChannelOpeningCandidate {
  agent: { id: string; name: string | null; title: string | null };
  /**
   * Whether the reply may move into a new Thread: only a request on a group's main timeline can.
   * A direct conversation is a DM with the Agent, where a bot never opens one either.
   */
  canOpenThread: boolean;
  /** Public messages just before the request, oldest first. */
  recent: ChannelContextMessage[];
  request: ChannelContextMessage;
  requesterUserId: string;
  workspaceId: string | null;
}

/** How the opener decided to open the reply. Both empty means the run simply starts. */
export interface ChannelOpeningDecision {
  ack?: string;
  /** Present when the reply moves into a new Thread named this. */
  threadTitle?: string;
}

const isOpened = async (db: LobeChatDatabase | Transaction, jobId: string) => {
  const [row] = await db
    .select({ id: channelAudit.id })
    .from(channelAudit)
    .where(and(eq(channelAudit.targetId, jobId), eq(channelAudit.event, REPLY_OPENED_EVENT)))
    .limit(1);
  return !!row;
};

/**
 * Whether a job opens its reply before the run: an owed answer only. A follow-up nobody asked
 * for, or one deferred behind another member's answer, may stay silent and never acknowledges.
 */
export const opensReply = (job: { wake: { afterMemberId?: string; kind: string } | null }) =>
  !job.wake || (job.wake.kind !== 'followup' && !job.wake.afterMemberId);

/**
 * The queued job's opening input, or undefined when it has nothing to open: already opened,
 * no longer queued, a wake that may stay silent, or a member or requester that is gone.
 */
export const findOpeningCandidate = async (
  db: LobeChatDatabase,
  channelId: string,
  jobId: string,
): Promise<ChannelOpeningCandidate | undefined> => {
  const [row] = await db
    .select({
      job: channelJobs,
      agentId: channelMembers.agentId,
      agentName: agents.name,
      agentTitle: agents.title,
    })
    .from(channelJobs)
    .innerJoin(channelMembers, eq(channelMembers.id, channelJobs.memberId))
    .leftJoin(agents, eq(agents.id, channelMembers.agentId))
    .where(
      and(
        eq(channelJobs.channelId, channelId),
        eq(channelJobs.id, jobId),
        eq(channelJobs.status, 'queued'),
        eq(channelMembers.status, 'active'),
      ),
    );
  if (!row?.agentId || !opensReply(row.job) || (await isOpened(db, jobId))) return;
  const { job } = row;

  const [requester] = await db
    .select({ userId: channelMembers.userId })
    .from(channelMembers)
    .where(and(eq(channelMembers.id, job.requesterMemberId), eq(channelMembers.status, 'active')));
  if (!requester?.userId) return;

  const [[request], [thread], [channel]] = await Promise.all([
    db
      .select({ sequence: channelMessages.sequence })
      .from(channelMessages)
      .where(eq(channelMessages.id, job.messageId)),
    job.threadId
      ? db
          .select({ rootSequence: channelThreads.rootSequence })
          .from(channelThreads)
          .where(eq(channelThreads.id, job.threadId))
      : [],
    db
      .select({ agentId: channels.agentId, workspaceId: channels.workspaceId })
      .from(channels)
      .where(eq(channels.id, channelId)),
  ]);
  if (!request || !channel) return;
  // The request's branch up to the request itself, as the run's manifest will freeze it.
  const messages = await readManifestMessages(
    db,
    channelId,
    {
      cutoffSequence: request.sequence,
      requestMessageId: job.messageId,
      requesterMemberId: job.requesterMemberId,
      self: { agentId: row.agentId, memberId: job.memberId, name: '' },
      threadId: job.threadId,
      threadRootSequence: thread?.rootSequence ?? null,
    },
    { limit: OPENING_CONTEXT_LIMIT + 1 },
  );
  const requestMessage = messages.find((message) => message.id === job.messageId);
  if (!requestMessage) return;

  return {
    agent: { id: row.agentId, name: row.agentName, title: row.agentTitle },
    canOpenThread: !job.threadId && !channel.agentId,
    recent: messages.filter((message) => message.id !== job.messageId),
    request: requestMessage,
    requesterUserId: requester.userId,
    workspaceId: channel.workspaceId,
  };
};

/**
 * Applies the opener's decision to a still-queued job, once: posts the acknowledgement as the
 * replying Agent in the request's branch, then opens the Thread under it (under the request when
 * there is none) and moves the job into it. Records the opening even when nothing was posted, so the opener is not asked again.
 * Returns false when another worker opened the job first or it already started.
 */
export const applyOpening = async (
  db: LobeChatDatabase,
  channelId: string,
  jobId: string,
  decision: ChannelOpeningDecision,
): Promise<boolean> =>
  withChannelLock(db, channelId, async (tx, channel) => {
    const [job] = await tx
      .select()
      .from(channelJobs)
      .where(
        and(
          eq(channelJobs.channelId, channelId),
          eq(channelJobs.id, jobId),
          eq(channelJobs.status, 'queued'),
        ),
      );
    if (!job || (await isOpened(tx, jobId))) return false;
    const [member] = await tx
      .select({ agentId: channelMembers.agentId })
      .from(channelMembers)
      .where(and(eq(channelMembers.id, job.memberId), eq(channelMembers.status, 'active')));
    if (!member?.agentId) return false;

    // The acknowledgement goes where the person is looking: the request's own branch, answering
    // the request. A Thread opens under it, so the person sees the reply start and where it went.
    const ack = decision.ack?.trim();
    const posted = ack
      ? await appendMessage(tx, {
          agentId: member.agentId,
          channelId,
          content: ack,
          replyToId: job.messageId,
          requestKey: openingRequestKey(job.id),
          routingStatus: 'reply',
          threadId: job.threadId,
        })
      : undefined;

    let threadId = job.threadId;
    const title = decision.threadTitle?.trim().slice(0, THREAD_TITLE_LENGTH);
    // Without an acknowledgement the Thread opens under the request itself, unless an archived
    // one already sits there: it takes no new work, so the reply stays where it was asked.
    const rootMessageId = posted?.id ?? job.messageId;
    if (
      title &&
      !threadId &&
      !channel.agentId &&
      !(await hasArchivedThread(tx, channelId, rootMessageId))
    ) {
      // Follow-ups deferred behind this answer move with it: they must read it to stay silent.
      const deferred = await tx
        .select({ id: channelJobs.id, memberId: channelJobs.memberId })
        .from(channelJobs)
        .where(
          and(
            eq(channelJobs.channelId, channelId),
            eq(channelJobs.messageId, job.messageId),
            eq(channelJobs.status, 'queued'),
            isNull(channelJobs.threadId),
            sql`${channelJobs.wake}->>'afterMemberId' = ${job.memberId}`,
          ),
        );
      const candidates = [
        ...new Set([
          job.requesterMemberId,
          job.memberId,
          ...deferred.map(({ memberId }) => memberId),
        ]),
      ];
      // A member who has left since the request no longer follows anything.
      const followers = (
        await tx
          .select({ id: channelMembers.id })
          .from(channelMembers)
          .where(
            and(
              eq(channelMembers.channelId, channelId),
              eq(channelMembers.status, 'active'),
              inArray(channelMembers.id, candidates),
            ),
          )
      ).map(({ id }) => id);
      const thread = await createChannelThread(tx, channelId, {
        followerMemberIds: followers,
        rootMessageId,
      });
      // A Thread already open under the request (another Agent's answer without an
      // acknowledgement, or one someone branched) keeps its name, and gains whoever answers in it.
      await followThread(tx, thread, followers);
      if (!thread.metadata?.title) await nameThread(tx, thread.id, title);
      threadId = thread.id;
      await tx
        .update(channelJobs)
        .set({ threadId })
        .where(inArray(channelJobs.id, [job.id, ...deferred.map(({ id }) => id)]));
    }

    await audit(tx, channelId, REPLY_OPENED_EVENT, job.id, {
      ...(posted && { messageId: posted.id }),
      ...(threadId !== job.threadId && { threadId }),
    });

    return true;
  });

const hasArchivedThread = async (tx: Transaction, channelId: string, rootMessageId: string) => {
  const [thread] = await tx
    .select({ status: channelThreads.status })
    .from(channelThreads)
    .where(
      and(
        eq(channelThreads.channelId, channelId),
        eq(channelThreads.rootMessageId, rootMessageId),
        notTrashed(channelThreads.isDeleted),
      ),
    );
  return thread?.status === 'archived';
};

/** Adds `memberIds` the Thread does not follow yet; the caller passes active members only. */
const followThread = async (
  tx: Transaction,
  thread: { followerMemberIds: string[]; id: string },
  memberIds: string[],
) => {
  const missing = memberIds.filter((id) => !thread.followerMemberIds.includes(id));
  if (!missing.length) return;
  await tx
    .update(channelThreads)
    .set({ followerMemberIds: [...thread.followerMemberIds, ...missing] })
    .where(eq(channelThreads.id, thread.id));
};

const nameThread = async (tx: Transaction, threadId: string, title: string) => {
  const [thread] = await tx
    .select({ metadata: channelThreads.metadata })
    .from(channelThreads)
    .where(eq(channelThreads.id, threadId));
  await tx
    .update(channelThreads)
    .set({ metadata: { ...thread?.metadata, title } })
    .where(eq(channelThreads.id, threadId));
};

/** The acknowledgement a job posted before its run, for the run to continue from. */
export const findOpeningReply = async (
  db: LobeChatDatabase | Transaction,
  channelId: string,
  jobId: string,
): Promise<{ content: string; id: string } | undefined> => {
  const [message] = await db
    .select({ content: channelMessages.content, id: channelMessages.id })
    .from(channelMessages)
    .where(
      and(
        eq(channelMessages.channelId, channelId),
        eq(channelMessages.requestKey, openingRequestKey(jobId)),
      ),
    )
    .limit(1);
  return message;
};
