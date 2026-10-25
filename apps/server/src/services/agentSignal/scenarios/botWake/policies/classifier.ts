import type { BotWakeMessageKind } from '@lobechat/prompts';

import type { WakePolicy, WakePolicyMode, WakePolicyResult, WakeRules, WakeSignal } from '../types';

export const CLASSIFIER_POLICY_ID = 'bot-wake:classifier';

/** A model call that has not answered by now is dropped and the wake passes. */
export const CLASSIFIER_TIMEOUT_MS = 2000;

export interface WakeClassification {
  /** 0..1: how likely the author is talking to the bot. */
  addressedToBot: number;
  kind: BotWakeMessageKind;
  reason: string;
}

export interface WakeClassifierInput {
  customInstructions?: string;
  signal: WakeSignal;
}

/** Calls the model. Must honour `abortSignal`; the policy also stops waiting on its own. */
export type WakeClassify = (
  input: WakeClassifierInput,
  abortSignal: AbortSignal,
) => Promise<WakeClassification>;

const degraded = (reason: string): WakePolicyResult => ({
  // Failing open: a classifier outage must not silence a bot that is otherwise allowed to speak.
  confidence: 0,
  reason,
  tags: ['classifier', 'degraded'],
  verdict: 'allow',
});

/**
 * Scores whether a plain message is addressed to the bot.
 *
 * Use when:
 * - A message passed the cheap rules and is not an explicit @bot or reply
 *
 * Expects:
 * - `rules.classifier.mode` is the mode this policy is built with (`off` leaves it out of the
 *   set); in `shadow` the score is recorded and nothing is blocked
 *
 * Returns:
 * - `confidence` = the 0..1 score, tag `kind:<request|chitchat|other>`
 * - `deny` when the score is under `rules.classifier.threshold`, otherwise `allow`
 * - `allow` with tag `degraded` when the model errors, answers late (2s) or is not configured
 */
export const createClassifierPolicy = (
  mode: WakePolicyMode,
  rules: WakeRules,
  classify: WakeClassify,
  timeoutMs = CLASSIFIER_TIMEOUT_MS,
): WakePolicy => ({
  costly: true,
  evaluate: async ({ signal }) => {
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
        classify({ customInstructions: rules.customInstructions, signal }, controller.signal),
        timedOut,
      ]);

      if (outcome === 'timeout') return degraded('classifier-timeout');

      const verdict = outcome.addressedToBot >= rules.classifier.threshold ? 'allow' : 'deny';

      return {
        confidence: outcome.addressedToBot,
        reason: outcome.reason || `score ${outcome.addressedToBot.toFixed(2)}`,
        tags: ['classifier', `kind:${outcome.kind}`],
        verdict,
      };
    } catch (error) {
      return degraded(
        `classifier-error: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  },
  id: CLASSIFIER_POLICY_ID,
  mode,
  requires: ['channel'],
  version: 1,
});
