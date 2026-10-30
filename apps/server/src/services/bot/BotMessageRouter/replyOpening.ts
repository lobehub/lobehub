import type { BotWakeKind, SignalDecisionVerdict } from '@lobechat/types';
import debug from 'debug';

import { describeLine } from '@/server/services/agentSignal/scenarios/botWake/conversation';
import type { WakeConversation } from '@/server/services/agentSignal/scenarios/botWake/types';

import type { BotReplyPlacementMode, PlatformClient, ReplyTargets } from '../platforms';
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

/**
 * How long a channel stays claimed by an opening that never reaches the bridge (an early return or
 * a thrown error between the two). The handler releases the claim long before this.
 */
export const CHANNEL_CLAIM_TTL_MS = 60_000;

/**
 * Channels an opening has picked whose run has not reached the bridge yet. The bridge only marks a
 * conversation active once `handleMention` starts, and the acknowledgement is posted before that,
 * so two openings at once could otherwise both pick the same free channel; the bridge would then
 * drop the second run and leave its acknowledgement unanswered. Per process, like the bridge's own
 * active set.
 */
const channelClaims = new Map<string, { expiresAt: number; token: symbol }>();

const isClaimed = (channel: string) => {
  const claim = channelClaims.get(channel);
  if (!claim) return false;
  if (claim.expiresAt > Date.now()) return true;
  channelClaims.delete(channel);

  return false;
};

/** Claims `channel` until the returned release runs (or the TTL passes). */
const claimChannel = (channel: string) => {
  const token = Symbol(channel);
  channelClaims.set(channel, { expiresAt: Date.now() + CHANNEL_CLAIM_TTL_MS, token });

  return () => {
    if (channelClaims.get(channel)?.token === token) channelClaims.delete(channel);
  };
};

/** Drops every channel claim. Tests only. */
export const resetChannelClaims = () => channelClaims.clear();

const noop = () => {};

/** The thread a handler is about to reply in. Its `id` is swapped when a reply thread opens. */
export interface OpeningThread {
  id: string;
  post: (message: string) => Promise<unknown>;
  startTyping?: () => Promise<unknown>;
}

export interface OpeningMessage {
  id?: string;
  raw?: unknown;
  text?: string;
}

export interface ReplyOpeningResult {
  /** The acknowledgement posted before the run, for the agent to continue from. */
  openingReply?: string;
  /**
   * Ends the opening's claim on the channel it picked. Call it once the bridge has taken the run
   * (after `handleMention` / `handleSubscribedMessage`), which marks the conversation active itself.
   */
  release: () => void;
  /** How the opening went, for the wake decision row. Absent when nothing was decided. */
  verdict?: SignalDecisionVerdict;
}

export interface ReplyOpeningDeps {
  /** The bot's own platform id, so its earlier lines read as its own. */
  applicationId: string;
  client: Pick<PlatformClient, 'getReplyTargets'>;
  /**
   * Whether the bot is already answering in a conversation. A second reply in a busy channel
   * would be dropped as a duplicate, so it moves into a thread instead.
   */
  isBusy?: (platformThreadId: string) => boolean;
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
   * Whether the bot decides where it answers. When it does, an adapter that opens a thread for an
   * @-mention on its own (Discord) must not.
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
    if (mode !== 'agent' || !opener || !client.getReplyTargets) return false;
    try {
      return await deps.rolledOut();
    } catch {
      return false;
    }
  };

  const moveTo = (thread: OpeningThread, platformThreadId: string) => {
    if (platformThreadId === thread.id) return;
    log('reply moves %s -> %s', thread.id, platformThreadId);
    thread.id = platformThreadId;
  };

  /** Moves the reply into the thread under the message; `false` leaves `thread.id` as it was. */
  const openThread = async (
    thread: OpeningThread,
    targets: ReplyTargets | undefined,
    name?: string,
  ) => {
    if (!targets) return false;
    try {
      const opened = await targets.openThread(targets.namesThread ? name : undefined);
      if (!opened) return false;
      moveTo(thread, opened);

      return true;
    } catch (error) {
      log('openThread threw, replying in the channel: %O', error);

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
    // One deadline for the whole opening: the context lookup (bot names, identity, recent lines)
    // can stall too, and the bot must not stay silent past it.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const ask = async () => {
      const conversation = await readConversation(input);
      if (controller.signal.aborted) throw new Error('timeout');

      return opener!(
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
      );
    };
    try {
      return await Promise.race([
        ask(),
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
    const targets = client.getReplyTargets?.(thread.id, message);

    if (!(await decidesPlacement())) {
      // As before: a reply thread opens where one used to, wherever the platform has one.
      if (legacyOpensThread) await openThread(thread, targets);

      return { release: noop };
    }

    // Nobody asked: join the conversation where it is, and say nothing before the run decides
    // whether to speak at all.
    if (wakeKind === 'followup') {
      if (targets) moveTo(thread, targets.channel);

      return { release: noop, verdict: verdictOf('channel:followup', 0, 'abstain') };
    }

    // Show life while the bot decides; the channel is where the person is looking.
    void thread.startTyping?.().catch(() => {});

    const startedAt = Date.now();
    let opening: ReplyOpening;
    try {
      opening = await decide(input, !!targets);
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
      const opened = await openThread(thread, targets);

      return {
        release: noop,
        verdict: verdictOf(
          `${opened ? 'thread' : 'channel'}:fallback-${failure}`,
          latencyMs,
          'abstain',
        ),
      };
    }
    const latencyMs = Date.now() - startedAt;

    // A channel the bot is already answering in, or another opening has just picked, cannot take
    // a second reply at the same time.
    const channelBusy =
      !!targets &&
      opening.placement === 'channel' &&
      (!!deps.isBusy?.(targets.channel) || isClaimed(targets.channel));
    let inThread = false;
    let release = noop;
    if (targets) {
      if (opening.placement === 'thread' || channelBusy) {
        inThread = await openThread(thread, targets, opening.title);
      }
      if (!inThread) {
        moveTo(thread, targets.channel);
        // Claimed before the acknowledgement is awaited, so a concurrent opening sees it.
        release = claimChannel(targets.channel);
      }
    }

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
      release,
      verdict: verdictOf(
        `${inThread ? 'thread' : 'channel'}${channelBusy ? ':channel-busy' : ''}${openingReply ? '+ack' : ''}`,
        latencyMs,
      ),
    };
  };

  return { decidesPlacement, open };
};
