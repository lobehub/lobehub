import { isEmptyOrEmojiOnly } from '../facts';
import type { WakePolicy, WakePolicyResult, WakeRules } from '../types';
import type { WakeClassifierInput } from './classifier';
import { CLASSIFIER_TIMEOUT_MS } from './classifier';

export const DUTY_POLICY_ID = 'bot-wake:duty';

/** Messages shorter than this carry nothing to act on ("ok", "+1", "嗯"). */
const MIN_DUTY_MESSAGE_LENGTH = 6;

/** Longest duty named in the stored verdict reason. The woken agent gets the full duty. */
const DUTY_LABEL_LENGTH = 120;

const dutyLabel = (duty: string) => {
  const line = duty.replaceAll(/\s+/g, ' ').trim();
  return line.length > DUTY_LABEL_LENGTH ? `${line.slice(0, DUTY_LABEL_LENGTH - 1)}…` : line;
};

/** Another person spoke this recently, right before the author: the author is answering them. */
const ANSWERING_OTHER_MS = 2 * 60 * 1000;

export interface WakeDutyInput extends WakeClassifierInput {
  /** The bot's duties, as its owner wrote them. */
  duties: string;
}

export interface WakeDutyJudgement {
  /** The duty the message falls within, in full; absent when the model did not say. */
  duty?: string;
  /** 0..1: how likely the message falls within the bot's duties, so it should step in now. */
  inDuty: number;
  reason: string;
}

/** Calls the model. Must honour `abortSignal`; the policy also stops waiting on its own. */
export type WakeDutyJudge = (
  input: WakeDutyInput,
  abortSignal: AbortSignal,
) => Promise<WakeDutyJudgement>;

const abstain = (reason: string): WakePolicyResult => ({
  confidence: 0,
  reason,
  tags: ['duty', reason],
  verdict: 'abstain',
});

const degraded = (reason: string): WakePolicyResult => ({
  confidence: 0,
  reason,
  tags: ['duty', 'degraded'],
  verdict: 'abstain',
});

/**
 * Whether the bot should step in, unasked, because a message falls within the duties its owner
 * gave it: "assess the feature requests people describe; for easy ones create a task for dario".
 *
 * The addressed classifier asks a different question (is the message for the bot?) and is right
 * to say no here: a teammate describing a feature they want is talking to the room. This one asks
 * whether a teammate holding these duties would step in, for anyone's message, not only the
 * owner's.
 *
 * Use when:
 * - Nothing else woke the bot: it was not named, not @-mentioned, outside the follow-up window,
 *   and no rule denied the message but owner presence, which keeps the bot out of chatter, not
 *   off its duties. The recorder's `initiate` runs it last; it is not part of the policy set the
 *   other paths evaluate.
 *
 * Expects:
 * - `rules.duties.text` is set; without duties the recorder does not build this policy
 *
 * Returns:
 * - `abstain` without a model call for a message too short to act on, and for a reply to someone
 *   else: the author is answering that person, and the model, which only sees the text, reads the
 *   "你" in it as the assistant. The same for a message right after another person spoke
 *   (`answering-other`): a conversation between people, reply or not
 * - `abstain` tagged `degraded` when the model errors or answers late: no answer is not a yes
 * - Otherwise `allow` when the score reaches `rules.duties.threshold`, else `deny`; `confidence` is
 *   the score and `matched` the duty the model named
 */
export const createDutyPolicy = (
  rules: WakeRules,
  judge: WakeDutyJudge,
  timeoutMs = CLASSIFIER_TIMEOUT_MS,
): WakePolicy => ({
  costly: true,
  evaluate: async ({ signal, state }) => {
    const duties = rules.duties.text;
    if (!duties) return abstain('no-duties');
    const authorId = signal.author?.id;
    if (
      signal.replyToAuthorId &&
      signal.replyToAuthorId !== signal.applicationId &&
      signal.replyToAuthorId !== authorId
    ) {
      return abstain('reply-to-other');
    }
    const previous = state.conversation?.recent.at(-1);
    if (
      previous &&
      !previous.isBot &&
      previous.authorId !== undefined &&
      previous.authorId !== authorId &&
      signal.timestamp - previous.at < ANSWERING_OTHER_MS
    ) {
      return abstain('answering-other');
    }
    if (
      isEmptyOrEmojiOnly(signal.message, signal.hasAttachments) ||
      signal.message.trim().length < MIN_DUTY_MESSAGE_LENGTH
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
            duties,
            signal,
          },
          controller.signal,
        ),
        timedOut,
      ]);

      if (outcome === 'timeout') return degraded('duty-timeout');

      const matched = outcome.duty?.trim() || undefined;
      const reason = outcome.reason || `score ${outcome.inDuty.toFixed(2)}`;

      return {
        confidence: outcome.inDuty,
        matched,
        // The stored verdict keeps only the reason, so it names the duty too, shortened.
        reason: matched ? `[${dutyLabel(matched)}] ${reason}` : reason,
        tags: ['duty'],
        verdict: outcome.inDuty >= rules.duties.threshold ? 'allow' : 'deny',
      };
    } catch (error) {
      return degraded(`duty-error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timer);
    }
  },
  id: DUTY_POLICY_ID,
  mode: rules.duties.mode,
  requires: ['channel', 'conversation'],
  version: 1,
});
