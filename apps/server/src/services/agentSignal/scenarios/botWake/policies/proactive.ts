import { isEmptyOrEmojiOnly } from '../facts';
import type { WakePolicy, WakePolicyResult, WakeRules } from '../types';
import type { WakeClassifierInput } from './classifier';
import { CLASSIFIER_TIMEOUT_MS } from './classifier';

export const PROACTIVE_POLICY_ID = 'bot-wake:proactive';

/** Messages shorter than this carry no request to act on ("ok", "+1", "嗯"). */
const MIN_PROACTIVE_MESSAGE_LENGTH = 6;

export interface WakeProactiveJudgement {
  /** 0..1: how likely the owner would welcome the bot stepping in now. */
  helpful: number;
  reason: string;
}

/** Calls the model. Must honour `abortSignal`; the policy also stops waiting on its own. */
export type WakeProactiveJudge = (
  input: WakeClassifierInput,
  abortSignal: AbortSignal,
) => Promise<WakeProactiveJudgement>;

const abstain = (reason: string): WakePolicyResult => ({
  confidence: 0,
  reason,
  tags: ['proactive', reason],
  verdict: 'abstain',
});

const degraded = (reason: string): WakePolicyResult => ({
  confidence: 0,
  reason,
  tags: ['proactive', 'degraded'],
  verdict: 'abstain',
});

/**
 * Whether the bot should step in, unasked, because its owner raised something it can help with:
 * "this page still looks too busy, need to think about how to refine it".
 *
 * The addressed classifier asks a different question (is the message for the bot?) and is right
 * to say no here: the owner is talking to the room. This one asks whether a teammate would offer
 * help, and only for the owner, whom the bot works for.
 *
 * Use when:
 * - Nothing else woke the bot: it was not named, not @-mentioned, outside the follow-up window,
 *   and no rule denied the message. The recorder's `initiate` runs it last; it is not part of the
 *   policy set the other paths evaluate.
 *
 * Returns:
 * - `abstain` without a model call for anyone but the owner, and for a message too short to act on
 * - `abstain` tagged `degraded` when the model errors or answers late: no answer is not a yes
 * - Otherwise `allow` when the score reaches `rules.proactive.threshold`, else `deny`;
 *   `confidence` is the score
 */
export const createProactivePolicy = (
  rules: WakeRules,
  judge: WakeProactiveJudge,
  timeoutMs = CLASSIFIER_TIMEOUT_MS,
): WakePolicy => ({
  costly: true,
  evaluate: async ({ signal, state }) => {
    if (!signal.author?.isOwner) return abstain('not-owner');
    if (
      isEmptyOrEmojiOnly(signal.message, signal.hasAttachments) ||
      signal.message.trim().length < MIN_PROACTIVE_MESSAGE_LENGTH
    ) {
      return abstain('too-short');
    }

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      const timedOut = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve('timeout');
        }, timeoutMs);
      });
      const outcome = await Promise.race([
        judge(
          {
            conversation: state.conversation,
            customInstructions: rules.customInstructions,
            signal,
          },
          controller.signal,
        ),
        timedOut,
      ]);

      if (outcome === 'timeout') return degraded('proactive-timeout');

      return {
        confidence: outcome.helpful,
        reason: outcome.reason || `score ${outcome.helpful.toFixed(2)}`,
        tags: ['proactive'],
        verdict: outcome.helpful >= rules.proactive.threshold ? 'allow' : 'deny',
      };
    } catch (error) {
      return degraded(`proactive-error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timer);
    }
  },
  id: PROACTIVE_POLICY_ID,
  mode: rules.proactive.mode,
  requires: ['channel', 'conversation'],
  version: 1,
});
