import type { BotWakeKind, SignalDecisionVerdict } from '@lobechat/types';
import debug from 'debug';

import { describeLine } from '@/server/services/agentSignal/scenarios/botWake/conversation';
import type { WakeConversation } from '@/server/services/agentSignal/scenarios/botWake/types';

import type { BotReplyPlacementMode, PlatformClient } from '../platforms';
import type { ReplyOpener, ReplyOpening } from '../wake/opener';

const log = debug('lobe-server:bot:reply-opening');

/** Policy id the opening is recorded under, beside the wake verdicts of the same message. */
export const REPLY_OPENER_POLICY_ID = 'reply-opener';

/**
 * How long the bot waits for its opening before falling back. The opening sits before the run
 * starts, so every second here is a second without a reply; a chat model answering a short JSON
 * usually takes one to three.
 */
export const REPLY_OPENER_TIMEOUT_MS = 5000;

/** The thread a handler is about to reply in. Its `id` is swapped when a reply thread opens. */
export interface OpeningThread {
  id: string;
  post: (message: string) => Promise<unknown>;
  startTyping?: () => Promise<unknown>;
}

export interface OpeningMessage {
  raw?: unknown;
  text?: string;
}

export interface ReplyOpeningResult {
  /** The acknowledgement posted before the run, for the agent to continue from. */
  openingReply?: string;
  /** How the opening went, for the wake decision row. Absent when nothing was decided. */
  verdict?: SignalDecisionVerdict;
}

export interface ReplyOpeningDeps {
  /** The bot's own platform id, so its earlier lines read as its own. */
  applicationId: string;
  client: Pick<PlatformClient, 'canOpenReplyThread' | 'openThreadForChannelWake'>;
  mode: BotReplyPlacementMode;
  opener?: ReplyOpener;
  /** The `bot_wake` rollout flag for the bot's owner: the bot decides only while it is on. */
  rolledOut: () => Promise<boolean>;
  timeoutMs?: number;
}

export interface OpenReplyInput {
  /** Names, identity and recent lines of the conversation, read before the thread may change. */
  conversation?: () => Promise<WakeConversation | undefined>;
  /**
   * Whether the previous behaviour opened a reply thread here before the run (a keyword or name
   * wake in a channel). Only consulted when the bot does not decide.
   */
  legacyOpensThread?: boolean;
  message: OpeningMessage;
  thread: OpeningThread;
  wakeKind: BotWakeKind;
}

export interface ReplyOpeningService {
  /**
   * Whether the bot decides where it answers. When it does, the Discord adapter must not open a
   * thread for an @-mention on its own.
   */
  decidesPlacement: () => Promise<boolean>;
  /**
   * Opens the reply: decides whether to acknowledge and where to answer, opens the thread and
   * posts the acknowledgement. Swaps `thread.id` when a thread opens. Never throws.
   */
  open: (input: OpenReplyInput) => Promise<ReplyOpeningResult>;
}

const verdictOf = (
  reason: string,
  latencyMs: number,
  verdict: SignalDecisionVerdict['verdict'] = 'allow',
): SignalDecisionVerdict => ({
  confidence: 1,
  latencyMs,
  mode: 'enforce',
  policyId: REPLY_OPENER_POLICY_ID,
  reason,
  verdict,
  version: 1,
});

/**
 * Builds how a bot opens its reply to a message addressed to it.
 *
 * - When the owner leaves the placement to the bot (and the rollout is on), the bot decides with a
 *   short model call: a quick answer stays in the channel, work that runs long moves into a thread
 *   it names, and work that takes a while gets a one-sentence acknowledgement first. A wake nobody
 *   asked for (`followup`) answers in the channel and never acknowledges: it may still end silent.
 * - Otherwise, and whenever the model call fails, it behaves as before: a reply thread opens where
 *   one used to, and nothing is posted before the run.
 */
export const createReplyOpening = (deps: ReplyOpeningDeps): ReplyOpeningService => {
  const { client, mode, opener } = deps;
  const timeoutMs = deps.timeoutMs ?? REPLY_OPENER_TIMEOUT_MS;

  const decidesPlacement = async () => {
    if (mode !== 'agent' || !opener || !client.canOpenReplyThread) return false;
    try {
      return await deps.rolledOut();
    } catch {
      return false;
    }
  };

  const openThread = async (thread: OpeningThread, message: OpeningMessage, name?: string) => {
    if (!client.openThreadForChannelWake) return false;
    try {
      const upgraded = await client.openThreadForChannelWake(thread.id, message.raw, name);
      if (!upgraded || upgraded === thread.id) return false;
      log('opened reply thread %s -> %s', thread.id, upgraded);
      thread.id = upgraded;

      return true;
    } catch (error) {
      log('openThreadForChannelWake threw, replying in the channel: %O', error);

      return false;
    }
  };

  const readConversation = async (input: OpenReplyInput) => {
    try {
      return await input.conversation?.();
    } catch (error) {
      log('conversation lookup failed: %O', error);
    }
  };

  const decide = async (input: OpenReplyInput, canOpenThread: boolean): Promise<ReplyOpening> => {
    const conversation = await readConversation(input);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await Promise.race([
        opener!(
          {
            agent: conversation?.agent,
            botNames: conversation?.botNames,
            canOpenThread,
            message: input.message.text ?? '',
            recentMessages: conversation?.recent.map((line) =>
              describeLine(line, deps.applicationId, conversation.ownerId),
            ),
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

  const open = async (input: OpenReplyInput): Promise<ReplyOpeningResult> => {
    const { legacyOpensThread = false, message, thread, wakeKind } = input;
    const canOpenThread = client.canOpenReplyThread?.(thread.id) ?? false;

    if (!(await decidesPlacement())) {
      // As before: the platform's hook alone decides whether a thread opens.
      if (legacyOpensThread) await openThread(thread, message);

      return {};
    }

    // Nobody asked: join the conversation where it is, and say nothing before the run decides
    // whether to speak at all.
    if (wakeKind === 'followup') return { verdict: verdictOf('channel:followup', 0, 'abstain') };

    // Show life while the bot decides; the channel is where the person is looking.
    void thread.startTyping?.().catch(() => {});

    const startedAt = Date.now();
    let opening: ReplyOpening;
    try {
      opening = await decide(input, canOpenThread);
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const failure = (error as Error)?.message === 'timeout' ? 'timeout' : 'error';
      log(
        'opener failed (%s) after %dms, keeping the previous behaviour: %O',
        failure,
        latencyMs,
        error,
      );
      // The previous behaviour: every channel wake got its own thread.
      const opened = canOpenThread && (await openThread(thread, message));

      return {
        verdict: verdictOf(
          `${opened ? 'thread' : 'channel'}:fallback-${failure}`,
          latencyMs,
          'abstain',
        ),
      };
    }
    const latencyMs = Date.now() - startedAt;

    const inThread =
      opening.placement === 'thread' && (await openThread(thread, message, opening.title));

    let openingReply: string | undefined;
    if (opening.ack) {
      try {
        await thread.post(opening.ack);
        openingReply = opening.ack;
      } catch (error) {
        log('posting the acknowledgement failed: %O', error);
      }
    }

    log(
      'opened reply: placement=%s (asked %s), ack=%s, %dms',
      inThread ? 'thread' : 'channel',
      opening.placement,
      !!openingReply,
      latencyMs,
    );

    return {
      openingReply,
      verdict: verdictOf(
        `${inThread ? 'thread' : 'channel'}${openingReply ? '+ack' : ''}`,
        latencyMs,
      ),
    };
  };

  return { decidesPlacement, open };
};
