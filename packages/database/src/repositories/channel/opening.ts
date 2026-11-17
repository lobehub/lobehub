import type { ChannelContextMessage } from '@lobechat/types';
import { and, eq, inArray, isNull, ne } from 'drizzle-orm';

import type { ChannelJobItem } from '../../schemas';
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
import type { OpeningFacts, OpeningLayout } from './openingLayout';
import { chooseOpeningLayout } from './openingLayout';
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

/** Another Agent the same request asked to answer, in parallel with this one. */
export interface ChannelCoAddressedAgent {
  name: string | null;
  title: string | null;
}

/** A queued job that may still open its reply, with what the opener needs to decide. */
export interface ChannelOpeningCandidate {
  agent: { id: string; name: string | null; title: string | null };
  /**
   * Whether the reply may move into a new Thread: only a request on the main timeline can, in a
   * group or a direct conversation alike, so a long run leaves that timeline free.
   */
  canOpenThread: boolean;
  /** The other Agents the request asked to answer; they share one Thread with this reply. */
  coAddressed: ChannelCoAddressedAgent[];
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
 * The other Agents that owe an answer to the same request: several Agents @mentioned in one
 * message, wherever their reply has moved since. A follow-up woken behind one of them is not asked, so it is not here.
 */
const coAddressedJobs = async (
  db: LobeChatDatabase | Transaction,
  job: Pick<ChannelJobItem, 'channelId' | 'id' | 'messageId' | 'wake'>,
) => {
  if (!opensReply(job)) return [];
  const rows = await db
    .select({ name: agents.name, title: agents.title, wake: channelJobs.wake })
    .from(channelJobs)
    .innerJoin(channelMembers, eq(channelMembers.id, channelJobs.memberId))
    .innerJoin(agents, eq(agents.id, channelMembers.agentId))
    .where(
      and(
        eq(channelJobs.channelId, job.channelId),
        eq(channelJobs.messageId, job.messageId),
        ne(channelJobs.id, job.id),
        ne(channelJobs.status, 'cancelled'),
      ),
    );
  return rows
    .filter(opensReply)
    .map(({ name, title }): ChannelCoAddressedAgent => ({ name, title }));
};

/** The other Agents a job's request asked to answer alongside it. See {@link coAddressedJobs}. */
export const findCoAddressed = async (
  db: LobeChatDatabase,
  channelId: string,
  jobId: string,
): Promise<ChannelCoAddressedAgent[]> => {
  const [job] = await db
    .select()
    .from(channelJobs)
    .where(and(eq(channelJobs.channelId, channelId), eq(channelJobs.id, jobId)));
  return job ? coAddressedJobs(db, job) : [];
};

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
      .select({ workspaceId: channels.workspaceId })
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
    canOpenThread: !job.threadId,
    coAddressed: await coAddressedJobs(db, job),
    recent: messages.filter((message) => message.id !== job.messageId),
    request: requestMessage,
    requesterUserId: requester.userId,
    workspaceId: channel.workspaceId,
  };
};

/**
 * Applies the opener's decision to a still-queued job, once: picks the layout with
 * `chooseOpeningLayout`, then opens the Thread and posts the acknowledgement where it says.
 * Records the opening even when nothing was posted, so the opener is not asked again.
 * Returns false when another worker opened the job first or it already started.
 */
export const applyOpening = async (
  db: LobeChatDatabase,
  channelId: string,
  jobId: string,
  decision: ChannelOpeningDecision,
): Promise<boolean> =>
  withChannelLock(db, channelId, async (tx) => {
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

    const ack = decision.ack?.trim();
    const title = decision.threadTitle?.trim().slice(0, THREAD_TITLE_LENGTH) ?? '';
    const layout = await planOpening(tx, channelId, job, { ack, title });

    let threadId = job.threadId;
    if (layout === 'underRequest') threadId = await openReplyThread(tx, job, job.messageId, title);

    // The acknowledgement answers the request where the reply continues: in place, or in the
    // Thread just opened (or joined) under the request.
    const posted = ack
      ? await appendMessage(tx, {
          agentId: member.agentId,
          channelId,
          content: ack,
          replyToId: job.messageId,
          requestKey: openingRequestKey(job.id),
          routingStatus: 'reply',
          threadId,
        })
      : undefined;

    if (layout === 'underAck')
      threadId = await openReplyThread(tx, job, posted?.id ?? job.messageId, title);

    await audit(tx, channelId, REPLY_OPENED_EVENT, job.id, {
      ...(posted && { messageId: posted.id }),
      ...(threadId !== job.threadId && { threadId }),
    });

    return true;
  });

/** Gathers the facts `chooseOpeningLayout` needs, reading the Channel only when they matter. */
const planOpening = async (
  tx: Transaction,
  channelId: string,
  job: ChannelJobItem,
  decision: { ack?: string; title: string },
): Promise<OpeningLayout> => {
  const wantsThread = !!decision.title;
  const inThread = !!job.threadId;
  const facts: OpeningFacts = {
    acknowledges: !!decision.ack,
    coAddressed: false,
    inThread,
    requestHasArchivedThread: false,
    requestHasOpenThread: false,
    sharedTimeline: false,
    wantsThread,
  };
  if (inThread) return chooseOpeningLayout(facts);
  facts.coAddressed = (await coAddressedJobs(tx, job)).length > 0;
  if (wantsThread || facts.coAddressed) {
    facts.requestHasArchivedThread = await hasArchivedThread(tx, channelId, job.messageId);
    facts.requestHasOpenThread = await openThreadUnder(tx, channelId, job.messageId);
  }
  if (wantsThread) facts.sharedTimeline = await hasSeveralPeople(tx, channelId);
  return chooseOpeningLayout(facts);
};

/** Whether more than one person is in the Channel, so its main timeline is shared. */
const hasSeveralPeople = async (tx: Transaction, channelId: string) => {
  const people = await tx
    .select({ id: channelMembers.id })
    .from(channelMembers)
    .where(
      and(
        eq(channelMembers.channelId, channelId),
        eq(channelMembers.actorType, 'user'),
        eq(channelMembers.status, 'active'),
      ),
    )
    .limit(2);
  return people.length > 1;
};

/**
 * Opens (or joins) the Thread under `rootMessageId` and moves the job into it, with every answer
 * still waiting on the same request: the follow-ups deferred behind it, and the peers that chose
 * to answer in place before the Thread existed. Returns the Thread's id.
 */
const openReplyThread = async (
  tx: Transaction,
  job: ChannelJobItem,
  rootMessageId: string,
  title: string,
) => {
  const { channelId } = job;
  // Every answer still waiting on this request moves with it: the follow-ups deferred behind this
  // one (they must read it to stay silent), and the peers that already chose to answer in place —
  // a run that started before the Thread opened must not publish outside it, or the same request's
  // answers split between the timeline and the Thread.
  const siblings = await tx
    .select({ id: channelJobs.id, memberId: channelJobs.memberId })
    .from(channelJobs)
    .where(
      and(
        eq(channelJobs.channelId, channelId),
        eq(channelJobs.messageId, job.messageId),
        inArray(channelJobs.status, ['queued', 'running']),
        isNull(channelJobs.publishedMessageId),
        isNull(channelJobs.threadId),
        ne(channelJobs.id, job.id),
      ),
    );
  const candidates = [
    ...new Set([job.requesterMemberId, job.memberId, ...siblings.map(({ memberId }) => memberId)]),
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
  // A Thread already open under the root (another Agent's answer to the same request, or one
  // someone branched) keeps its name, and gains whoever answers in it.
  await followThread(tx, thread, followers);
  if (!thread.metadata?.title && title) await nameThread(tx, thread.id, title);
  await tx
    .update(channelJobs)
    .set({ threadId: thread.id })
    .where(inArray(channelJobs.id, [job.id, ...siblings.map(({ id }) => id)]));
  return thread.id;
};

/** Whether a Thread someone can still answer in already sits under `rootMessageId`. */
const openThreadUnder = async (tx: Transaction, channelId: string, rootMessageId: string) => {
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
  return !!thread && thread.status !== 'archived';
};

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
