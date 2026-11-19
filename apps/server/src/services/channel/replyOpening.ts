import type { LobeChatDatabase } from '@lobechat/database';
import type { ChannelContextMessage } from '@lobechat/types';
import { agentDisplayName } from '@lobechat/types';
import debug from 'debug';

import type { ChannelOpeningCandidate } from '@/database/repositories/channel';
import { ChannelExecutionRepository } from '@/database/repositories/channel';

import type { ChannelReplyOpener } from './opener';
import { CHANNEL_REPLY_OPENER_TIMEOUT_MS, createChannelReplyOpener } from './opener';
import { knownQuotaReset } from './quotaReset';

const log = debug('lobe-server:channel:reply-opening');

export interface OpenChannelReplyDeps {
  /**
   * Whether a shared Agent's share admits the request. A refused one does not open: its reply
   * fails at dispatch where it was asked, instead of acknowledging work it will not do.
   */
  admitShare?: (
    candidate: ChannelOpeningCandidate & Required<Pick<ChannelOpeningCandidate, 'share'>>,
  ) => Promise<boolean>;
  /** Builds the opener for a candidate; defaults to the Channel's, run as the requester. */
  createOpener?: (candidate: ChannelOpeningCandidate) => ChannelReplyOpener;
  /** When the Agent's usage window reopens, if a known one is still closed; see `knownQuotaReset`. */
  quotaReset?: (candidate: ChannelOpeningCandidate) => Promise<number | undefined>;
  timeoutMs?: number;
}

/** How much of a Thread's root and latest message the opener reads. */
const THREAD_EXCERPT_LENGTH = 160;

/** A failed check is no reason to skip the acknowledgement. */
const closedQuotaWindow = async (
  db: LobeChatDatabase,
  channelId: string,
  candidate: ChannelOpeningCandidate,
  deps: OpenChannelReplyDeps,
) => {
  try {
    return await (deps.quotaReset ?? ((entry) => knownQuotaReset(db, channelId, entry)))(candidate);
  } catch (error) {
    log('quota check failed, opening as usual: %O', error);
  }
};

const describe = (message: ChannelContextMessage, agentId: string) =>
  `${message.author.type === 'agent' && message.author.id === agentId ? 'Assistant' : message.author.name}: ${message.content}`;

const excerpt = (text: string | undefined) => {
  const line = text?.replaceAll(/\s+/g, ' ').trim();
  if (!line) return;
  return line.length > THREAD_EXCERPT_LENGTH ? `${line.slice(0, THREAD_EXCERPT_LENGTH)}…` : line;
};

/** The label the opener names a Thread by: its place among the candidates, nearest first. */
const threadLabel = (index: number) => `T${index + 1}`;

const defaultOpener =
  (db: LobeChatDatabase, channelId: string) => (candidate: ChannelOpeningCandidate) =>
    createChannelReplyOpener({
      agentId: candidate.agent.id,
      channelId,
      db,
      userId: candidate.requesterUserId,
      workspaceId: candidate.workspaceId ?? undefined,
    });

const decide = async (
  opener: ChannelReplyOpener,
  candidate: ChannelOpeningCandidate,
  timeoutMs: number,
) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await Promise.race([
      opener(
        {
          agent: {
            name: candidate.agent.name ?? undefined,
            title: candidate.agent.title ?? undefined,
          },
          // What people call it: its name, or the title an Agent without one goes by.
          botNames: [agentDisplayName(candidate.agent)].filter((name): name is string => !!name),
          canOpenThread: candidate.canOpenThread,
          coAddressed: candidate.coAddressed.map((agent) => ({
            name: agentDisplayName(agent) || undefined,
            title: agent.title ?? undefined,
          })),
          message: candidate.request.content,
          // Woken by its own rules, not asked: it acknowledges only a clear request for work.
          ...(!candidate.addressed && { notAddressed: true }),
          recentMessages: candidate.recent.map((message) => describe(message, candidate.agent.id)),
          threads: candidate.threads.map((thread, index) => ({
            label: threadLabel(index),
            lastMessage: excerpt(thread.lastMessage),
            root: excerpt(thread.root),
            title: thread.title,
          })),
        },
        controller.signal,
      ),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(new Error('timeout')));
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Opens an Agent member's reply before its run: a one-sentence acknowledgement when the work
 * takes a while, a Thread under the request when the answer runs long, or one of the Threads open
 * just before the request when it continues that subject. An owed answer opens; so does a follow-up leading the message, whose acknowledgement
 * commits it to answer. A follow-up deferred behind another member never does. Runs once per
 * job, before the claim, so the run's topic, branch and worktree follow the Thread.
 *
 * Never throws. A failed or slow opener is recorded as an opening that changed nothing, and the
 * reply starts where it was asked. So is a job whose Agent's last reply on the same CLI login was
 * refused by a usage window that has not reopened yet: the opener is not asked, so no
 * acknowledgement precedes the refusal.
 */
export const openChannelReply = async (
  db: LobeChatDatabase,
  channelId: string,
  jobId: string,
  deps: OpenChannelReplyDeps = {},
): Promise<void> => {
  const executions = new ChannelExecutionRepository(db);
  try {
    const candidate = await executions.openingCandidate(channelId, jobId);
    if (!candidate) return;
    if (
      candidate.share &&
      deps.admitShare &&
      !(await deps.admitShare({ ...candidate, share: candidate.share }))
    )
      return;

    // The Agent's last reply on the same login was refused by a usage window that is still
    // closed: an acknowledgement would promise work the run cannot do. It opens with nothing and
    // starts where it was asked, so the refusal shows as its failure instead; a window that
    // reopened early still answers.
    const resetsAt = await closedQuotaWindow(db, channelId, candidate, deps);
    if (resetsAt) {
      const opened = await executions.open(channelId, jobId, {});
      log('job %s opened=%s without ack: quota closed until %s', jobId, opened, resetsAt);
      return;
    }

    const startedAt = Date.now();
    let opening: Awaited<ReturnType<ChannelReplyOpener>> | undefined;
    try {
      opening = await decide(
        (deps.createOpener ?? defaultOpener(db, channelId))(candidate),
        candidate,
        deps.timeoutMs ?? CHANNEL_REPLY_OPENER_TIMEOUT_MS,
      );
    } catch (error) {
      log('opener failed after %dms, starting in place: %O', Date.now() - startedAt, error);
    }

    const continued =
      opening?.placement === 'existing_thread'
        ? candidate.threads.find((_, index) => threadLabel(index) === opening.thread)
        : undefined;
    const opened = await executions.open(channelId, jobId, {
      ack: opening?.ack,
      ...(continued && { threadId: continued.id }),
      threadTitle: opening?.placement === 'thread' ? opening.title : undefined,
    });
    log(
      'job %s opened=%s placement=%s ack=%s %dms',
      jobId,
      opened,
      opening?.placement ?? 'fallback',
      !!opening?.ack,
      Date.now() - startedAt,
    );
  } catch (error) {
    console.error('[channel:replyOpening]', error);
  }
};
