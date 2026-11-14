import type { LobeChatDatabase } from '@lobechat/database';
import type { ChannelContextMessage } from '@lobechat/types';
import { agentDisplayName } from '@lobechat/types';
import debug from 'debug';

import type { ChannelOpeningCandidate } from '@/database/repositories/channel';
import { ChannelExecutionRepository } from '@/database/repositories/channel';
import { REPLY_OPENER_TIMEOUT_MS } from '@/server/services/bot/BotMessageRouter/replyOpening';
import type { ReplyOpener } from '@/server/services/bot/wake/opener';
import { createReplyOpener } from '@/server/services/bot/wake/opener';

const log = debug('lobe-server:channel:reply-opening');

export interface OpenChannelReplyDeps {
  /** Builds the opener for a candidate; defaults to the bot's, run as the requester. */
  createOpener?: (candidate: ChannelOpeningCandidate) => ReplyOpener;
  timeoutMs?: number;
}

const describe = (message: ChannelContextMessage, agentId: string) =>
  `${message.author.type === 'agent' && message.author.id === agentId ? 'Assistant' : message.author.name}: ${message.content}`;

const defaultOpener = (db: LobeChatDatabase) => (candidate: ChannelOpeningCandidate) =>
  createReplyOpener({
    agentId: candidate.agent.id,
    db,
    userId: candidate.requesterUserId,
    workspaceId: candidate.workspaceId ?? undefined,
  });

const decide = async (
  opener: ReplyOpener,
  candidate: ChannelOpeningCandidate,
  timeoutMs: number,
) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await Promise.race([
      opener(
        {
          // The acknowledgement goes in the request's timeline with the Thread opening under it.
          ackPlacement: 'before-thread',
          agent: {
            name: candidate.agent.name ?? undefined,
            title: candidate.agent.title ?? undefined,
          },
          // What people call it: its name, or the title an Agent without one goes by.
          botNames: [agentDisplayName(candidate.agent)].filter((name): name is string => !!name),
          canOpenThread: candidate.canOpenThread,
          message: candidate.request.content,
          recentMessages: candidate.recent.map((message) => describe(message, candidate.agent.id)),
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
 * Opens an Agent member's reply before its run, as an IM bot does: a one-sentence
 * acknowledgement when the work takes a while, and a Thread under the request when the answer
 * runs long. Only an owed answer opens; a wake that may stay silent never does. Runs once per
 * job, before the claim, so the run's topic, branch and worktree follow the Thread.
 *
 * Never throws. A failed or slow opener is recorded as an opening that changed nothing, and the
 * reply starts where it was asked.
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

    const startedAt = Date.now();
    let opening: Awaited<ReturnType<ReplyOpener>> | undefined;
    try {
      opening = await decide(
        (deps.createOpener ?? defaultOpener(db))(candidate),
        candidate,
        deps.timeoutMs ?? REPLY_OPENER_TIMEOUT_MS,
      );
    } catch (error) {
      log('opener failed after %dms, starting in place: %O', Date.now() - startedAt, error);
    }

    const opened = await executions.open(channelId, jobId, {
      ack: opening?.ack,
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
