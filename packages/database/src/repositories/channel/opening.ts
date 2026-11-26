import type { ChannelContextMessage, ChannelSharedAgentAccess } from '@lobechat/types';
import { and, desc, eq, gte, inArray, isNull, lt, max, ne } from 'drizzle-orm';
import pMap from 'p-map';

import type { ChannelJobItem, ChannelMessageItem } from '../../schemas';
import {
  agentOperations,
  agents,
  channelAudit,
  channelJobs,
  channelMembers,
  channelMessages,
  channels,
  channelThreads,
} from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
import { agentTitleSql } from '../../utils/inboxAgent';
import { notTrashed } from '../../utils/softDelete';
import { accessShare, resolveChannelAgentAccess } from './agentAccess';
import { appendMessage } from './delivery';
import { readManifestMessages } from './manifest';
import { isMergedBehind } from './merge';
import type { OpeningFacts, OpeningLayout } from './openingLayout';
import { chooseOpeningLayout } from './openingLayout';
import { messageStands } from './tombstone';
import { audit, withChannelLock } from './transaction';
import { createChannelThread } from './view';

/** Audit event that marks a job's reply as opened; a job opens at most once. */
export const REPLY_OPENED_EVENT = 'reply_opened';

/** Longest stored thread title, the same bound the bot opener uses. */
const THREAD_TITLE_LENGTH = 60;

/** Messages before the request the opener sees, oldest first. */
const OPENING_CONTEXT_LIMIT = 6;

/**
 * Open Threads started before the request that its reply may continue in, nearest first. Counted
 * by where each sits on the timeline, so the choice stays about what was just being discussed.
 */
const OPENING_THREAD_LIMIT = 5;

/** Threads read before the filters below, so some are left for {@link OPENING_THREAD_LIMIT}. */
const OPENING_THREAD_SCAN_LIMIT = 20;

/**
 * How long a Thread may have been quiet before the request and still be continued. An older one
 * is a finished conversation: picking it up again hides the new request in it.
 */
const OPENING_THREAD_IDLE_MS = 2 * 60 * 60 * 1000;

/** Threads described at once; each reads two messages. */
const OPENING_THREAD_READ_CONCURRENCY = 3;

/** Thread reference a message carries, shown by clients as the Thread's chip. */
export const channelThreadReference = (threadId: string) => `<#${threadId}>`;

/** Request key of the acknowledgement a job posted before its run. */
export const openingRequestKey = (jobId: string) => `opening:${jobId}`;

/** Another Agent the same request asked to answer, in parallel with this one. */
export interface ChannelCoAddressedAgent {
  name: string | null;
  title: string | null;
}

/** An open Thread the reply may continue in, as the opener sees it. */
export interface ChannelOpeningThread {
  id: string;
  /** The latest standing message in the Thread. */
  lastMessage?: string;
  /** The message the Thread opened under, unless it was deleted. */
  root?: string;
  title?: string;
}

/** A queued job that may still open its reply, with what the opener needs to decide. */
export interface ChannelOpeningCandidate {
  /**
   * Whether someone addressed the Agent (owed answer). False for a follow-up its own rules woke:
   * the opener then acknowledges only a clear request for work.
   */
  addressed: boolean;
  agent: { id: string; name: string | null; title: string | null };
  /**
   * Whether the reply may move into a new Thread: only a request on the main timeline can, in a
   * group or a direct conversation alike, so a long run leaves that timeline free.
   */
  canOpenThread: boolean;
  /** The other Agents the request asked to answer; they share one Thread with this reply. */
  coAddressed: ChannelCoAddressedAgent[];
  /**
   * The device picked for the Agent in this Channel. Every reply of the member runs there, so
   * it names the run's target before the claim; without one only the claim resolves it.
   */
  deviceId?: string;
  /** The Agent's membership in this Channel, which its replies run as. */
  memberId: string;
  /** The message the request replies to, when its branch can read it. */
  quoted?: ChannelContextMessage;
  /** Public messages just before the request, oldest first. */
  recent: ChannelContextMessage[];
  request: ChannelContextMessage;
  requesterUserId: string;
  /**
   * Set when the Agent is another person's, reached through its share: the reply opens only once
   * the share admits the request, so a refused one fails where it was asked, with no acknowledgement.
   */
  share?: ChannelSharedAgentAccess;
  /**
   * Open Threads started before the request, nearest first, that the reply may continue in.
   * Empty when it cannot move: already in a Thread, or asked together with other Agents.
   */
  threads: ChannelOpeningThread[];
  workspaceId: string | null;
}

/** How the opener decided to open the reply. Both empty means the run simply starts. */
export interface ChannelOpeningDecision {
  ack?: string;
  /**
   * Present when the reply continues in this open Thread; it must still be one of the request's
   * {@link ChannelOpeningCandidate.threads}, or the reply starts in place.
   */
  threadId?: string;
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
 * Whether a job opens its reply before the run. An owed answer always does. So does a follow-up
 * that leads the message (its name in the text, a follow-up window, its duties): its opener
 * acknowledges only a clear request, and acknowledging commits it to answer (see
 * {@link applyOpening}). A follow-up deferred behind another member's answer never opens: it
 * reads that answer first, and most often stays silent.
 */
export const opensReply = (job: { wake: { afterMemberId?: string; kind: string } | null }) =>
  !job.wake?.afterMemberId;

/** Whether someone addressed the job's Agent, so it owes an answer and may not stay silent. */
const owesAnswer = (job: { wake: { afterMemberId?: string; kind: string } | null }) =>
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
    .select({ name: agents.name, title: agentTitleSql(), wake: channelJobs.wake })
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
    .filter(owesAnswer)
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
      agentTitle: agentTitleSql(),
      memberConfig: channelMembers.config,
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
    db.select().from(channelMessages).where(eq(channelMessages.id, job.messageId)),
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
  const access = await resolveChannelAgentAccess(
    db,
    channel,
    { agentId: row.agentId, id: job.memberId },
    { memberId: job.requesterMemberId, userId: requester.userId },
    job.threadId,
  );
  // A requester who may not use the Agent gets no acknowledgement: the reply waits for its
  // owner's answer, or fails, where it was asked.
  if (access.kind === 'request' || access.kind === 'unavailable') return;
  const share = accessShare(access);
  // Answered in the run of the same person's earlier request, which opens for both. A shared
  // Agent answers each of a visitor's requests in its own run.
  if (!share && (await isMergedBehind(db, job, request))) return;
  // The request's branch up to the request itself, as the run's manifest will freeze it.
  const manifest = {
    cutoffSequence: request.sequence,
    requestMessageId: job.messageId,
    requesterMemberId: job.requesterMemberId,
    self: { agentId: row.agentId, memberId: job.memberId, name: '' },
    threadId: job.threadId,
    threadRootSequence: thread?.rootSequence ?? null,
  };
  const messages = await readManifestMessages(db, channelId, manifest, {
    limit: OPENING_CONTEXT_LIMIT + 1,
  });
  const requestMessage = messages.find((message) => message.id === job.messageId);
  if (!requestMessage) return;
  const quotedId = requestMessage.replyToId;
  const quoted = quotedId
    ? (messages.find((message) => message.id === quotedId) ??
      (await readManifestMessages(db, channelId, manifest, { messageId: quotedId }))[0])
    : undefined;
  const coAddressed = await coAddressedJobs(db, job);

  return {
    addressed: owesAnswer(job),
    agent: { id: row.agentId, name: row.agentName, title: row.agentTitle },
    canOpenThread: !job.threadId,
    coAddressed,
    ...(row.memberConfig?.deviceId && { deviceId: row.memberConfig.deviceId }),
    memberId: job.memberId,
    ...(quoted && { quoted }),
    recent: messages.filter((message) => message.id !== job.messageId),
    request: requestMessage,
    requesterUserId: requester.userId,
    share,
    // Agents asked together share one new Thread under the request instead.
    threads:
      job.threadId || coAddressed.length
        ? []
        : await describeThreads(db, channelId, await continuableThreads(db, job, request)),
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
    // A follow-up that acknowledges has said it will answer: it owes the answer now, and may no
    // longer end in silence. One that does not stays optional, where it was asked.
    const optional = job.wake?.kind === 'followup';
    if (optional && ack)
      await tx
        .update(channelJobs)
        .set({ wake: { ...job.wake!, kind: 'mention' } })
        .where(eq(channelJobs.id, job.id));
    // Continuing in an open Thread: the acknowledgement answers the request where it was asked
    // and links the Thread, and the reply moves there.
    const existing =
      decision.threadId && !(optional && !ack)
        ? await continuableThread(tx, job, decision.threadId)
        : undefined;
    if (existing) {
      const posted = await appendMessage(tx, {
        agentId: member.agentId,
        channelId,
        content: [ack, channelThreadReference(existing.id)].filter(Boolean).join(' '),
        replyToId: job.messageId,
        requestKey: openingRequestKey(job.id),
        routingStatus: 'reply',
        threadId: null,
      });
      await joinThread(tx, job, existing);
      await audit(tx, channelId, REPLY_OPENED_EVENT, job.id, {
        continued: true,
        messageId: posted.id,
        ...(optional && { committed: true }),
        threadId: existing.id,
      });
      return true;
    }

    const title = decision.threadTitle?.trim().slice(0, THREAD_TITLE_LENGTH) ?? '';
    // An optional reply never opens or joins a Thread on its own: it may yet stay silent in it.
    const layout: OpeningLayout =
      optional && !ack ? 'inline' : await planOpening(tx, channelId, job, { ack, title });

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
      ...(optional && posted && { committed: true }),
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
 * Every answer still waiting on the job's request, and the active members who follow it: the
 * follow-ups deferred behind it (they must read it to stay silent), and the peers that already
 * chose to answer in place — a run that started before the move must not publish outside the
 * Thread, or the same request's answers split between the timeline and the Thread.
 */
const waitingOnRequest = async (tx: Transaction, job: ChannelJobItem) => {
  const { channelId } = job;
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
  return { followers, siblings };
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
  const { followers, siblings } = await waitingOnRequest(tx, job);
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

/** What {@link continuableThreads} reads of the request. */
const requestColumns = {
  createdAt: channelMessages.createdAt,
  replyToId: channelMessages.replyToId,
  sequence: channelMessages.sequence,
};

/**
 * Where the message a request quotes was answered, when it was a request itself: the Thread it
 * sits in, or the Threads its own answers moved into (none when they stayed in place). Undefined
 * when it quotes no request, such as a note nobody was asked about.
 */
const quotedRequestThreads = async (
  db: LobeChatDatabase | Transaction,
  channelId: string,
  replyToId: string | null,
): Promise<Set<string> | undefined> => {
  if (!replyToId) return;
  const [quoted] = await db
    .select({ threadId: channelMessages.threadId })
    .from(channelMessages)
    .where(and(eq(channelMessages.channelId, channelId), eq(channelMessages.id, replyToId)));
  if (!quoted) return;
  if (quoted.threadId) return new Set([quoted.threadId]);
  const answers = await db
    .select({ threadId: channelJobs.threadId })
    .from(channelJobs)
    .where(and(eq(channelJobs.channelId, channelId), eq(channelJobs.messageId, replyToId)));
  if (!answers.length) return;
  return new Set(answers.flatMap(({ threadId }) => (threadId ? [threadId] : [])));
};

/**
 * The open Threads a job's reply may continue in, nearest first: started on the main timeline
 * before the request, and still the Agent's own live conversation there.
 *
 * - The Agent follows it: it has answered there, so continuing is its own follow-up, not joining
 *   another Agent's work on a related subject.
 * - It was active within {@link OPENING_THREAD_IDLE_MS} of the request.
 * - No other Agent is answering in it right now.
 * - When the request quotes another request, it is where that one was answered: "this" means the
 *   quoted message, not whatever Thread sits nearest.
 */
const continuableThreads = async (
  db: LobeChatDatabase | Transaction,
  job: Pick<ChannelJobItem, 'channelId' | 'memberId'>,
  request: { createdAt: Date; replyToId: string | null; sequence: number },
) => {
  const { channelId } = job;
  const [scanned, quotedIn] = await Promise.all([
    db
      .select({
        createdAt: channelThreads.createdAt,
        followerMemberIds: channelThreads.followerMemberIds,
        id: channelThreads.id,
        metadata: channelThreads.metadata,
        rootMessageId: channelThreads.rootMessageId,
      })
      .from(channelThreads)
      .where(
        and(
          eq(channelThreads.channelId, channelId),
          lt(channelThreads.rootSequence, request.sequence),
          ne(channelThreads.status, 'archived'),
          notTrashed(channelThreads.isDeleted),
        ),
      )
      .orderBy(desc(channelThreads.rootSequence))
      .limit(OPENING_THREAD_SCAN_LIMIT),
    quotedRequestThreads(db, channelId, request.replyToId),
  ]);
  const followed = scanned.filter(
    (thread) =>
      thread.followerMemberIds.includes(job.memberId) && (!quotedIn || quotedIn.has(thread.id)),
  );
  if (!followed.length) return [];

  const ids = followed.map(({ id }) => id);
  const [activity, busy] = await Promise.all([
    db
      .select({ at: max(channelMessages.createdAt), threadId: channelMessages.threadId })
      .from(channelMessages)
      .where(and(eq(channelMessages.channelId, channelId), inArray(channelMessages.threadId, ids)))
      .groupBy(channelMessages.threadId),
    db
      .select({ threadId: channelJobs.threadId })
      .from(channelJobs)
      .where(
        and(
          eq(channelJobs.channelId, channelId),
          inArray(channelJobs.threadId, ids),
          inArray(channelJobs.status, ['queued', 'running']),
          ne(channelJobs.memberId, job.memberId),
        ),
      ),
  ]);
  const lastActive = new Map(activity.map(({ at, threadId }) => [threadId, at]));
  const answering = new Set(busy.map(({ threadId }) => threadId));
  const since = request.createdAt.getTime() - OPENING_THREAD_IDLE_MS;

  return followed
    .filter((thread) => {
      const active = lastActive.get(thread.id) ?? thread.createdAt;
      return active.getTime() >= since && !answering.has(thread.id);
    })
    .slice(0, OPENING_THREAD_LIMIT);
};

/** What the opener reads of each Thread: its name, where it started and where it is now. */
const describeThreads = async (
  db: LobeChatDatabase,
  channelId: string,
  threads: Awaited<ReturnType<typeof continuableThreads>>,
): Promise<ChannelOpeningThread[]> =>
  pMap(
    threads,
    async (thread) => {
      const [[root], [last]] = await Promise.all([
        db
          .select({ content: channelMessages.content })
          .from(channelMessages)
          .where(
            and(
              eq(channelMessages.channelId, channelId),
              eq(channelMessages.id, thread.rootMessageId),
              messageStands(),
            ),
          ),
        db
          .select({ content: channelMessages.content })
          .from(channelMessages)
          .where(
            and(
              eq(channelMessages.channelId, channelId),
              eq(channelMessages.threadId, thread.id),
              messageStands(),
            ),
          )
          .orderBy(desc(channelMessages.sequence))
          .limit(1),
      ]);
      const title = thread.metadata?.title;
      return {
        id: thread.id,
        ...(last?.content && { lastMessage: last.content }),
        ...(root?.content && { root: root.content }),
        ...(typeof title === 'string' && title && { title }),
      };
    },
    { concurrency: OPENING_THREAD_READ_CONCURRENCY },
  );

/**
 * The open Thread a job may continue in: still one of the Threads its opener was shown, checked
 * again under the lock, for a job on the main timeline that no other Agent was asked with.
 */
const continuableThread = async (tx: Transaction, job: ChannelJobItem, threadId: string) => {
  if (job.threadId || (await coAddressedJobs(tx, job)).length) return;
  const [request] = await tx
    .select(requestColumns)
    .from(channelMessages)
    .where(eq(channelMessages.id, job.messageId));
  if (!request) return;
  const threads = await continuableThreads(tx, job, request);
  return threads.find((thread) => thread.id === threadId);
};

/**
 * Moves the job into an open Thread with every answer still waiting on its request, as
 * {@link openReplyThread} does; the requester and the answering Agents then follow it.
 */
const joinThread = async (
  tx: Transaction,
  job: ChannelJobItem,
  thread: { followerMemberIds: string[]; id: string },
) => {
  const { followers, siblings } = await waitingOnRequest(tx, job);
  await followThread(tx, thread, followers);
  await tx
    .update(channelJobs)
    .set({ threadId: thread.id })
    .where(inArray(channelJobs.id, [job.id, ...siblings.map(({ id }) => id)]));
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
): Promise<Pick<ChannelMessageItem, 'content' | 'id' | 'metadata'> | undefined> => {
  const [message] = await db
    .select({
      content: channelMessages.content,
      id: channelMessages.id,
      metadata: channelMessages.metadata,
    })
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

/**
 * The newest reply of `memberId` on `deviceId` since `since` that finished: answered, chose
 * silence, or failed, with its run's error. A stopped reply says nothing about the device.
 */
export const findLastSettledReplyOnDevice = async (
  db: LobeChatDatabase,
  channelId: string,
  { deviceId, memberId, since }: { deviceId: string; memberId: string; since: Date },
) => {
  const [row] = await db
    .select({ error: agentOperations.error, status: channelJobs.status })
    .from(channelJobs)
    .leftJoin(agentOperations, eq(agentOperations.id, channelJobs.operationId))
    .where(
      and(
        eq(channelJobs.channelId, channelId),
        eq(channelJobs.memberId, memberId),
        eq(channelJobs.deviceId, deviceId),
        inArray(channelJobs.status, ['completed', 'failed', 'silent']),
        gte(channelJobs.createdAt, since),
      ),
    )
    .orderBy(desc(channelJobs.createdAt))
    .limit(1);
  return row;
};
