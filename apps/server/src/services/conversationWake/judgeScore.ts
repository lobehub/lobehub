import type { BotWakeJudgeKind, BotWakeJudgeScore, SignalDecisionVerdict } from '@lobechat/types';

import { CLASSIFIER_POLICY_ID } from '@/server/services/conversationWake/policies/classifier';
import { DUTY_POLICY_ID } from '@/server/services/conversationWake/policies/duty';

/** Policy id a routing decision model's answer is recorded under (Channel). */
export const ROUTING_JUDGE_POLICY_ID = 'channel:routing';

const KIND_BY_POLICY: Record<string, BotWakeJudgeKind> = {
  [CLASSIFIER_POLICY_ID]: 'addressed',
  [DUTY_POLICY_ID]: 'duty',
  [ROUTING_JUDGE_POLICY_ID]: 'routing',
};

/** Decisions the routing model made, whose score is the one that counts. */
const ROUTING_REASONS = new Set(['not-chosen', 'routing-selected', 'routing-uncertain']);

/**
 * A verdict that carries no score: the model timed out or failed (`*-timeout`, `*-error: …`), or
 * the duty judge abstained without asking it (a message too short, a reply to someone else).
 */
const isScored = (verdict: SignalDecisionVerdict) =>
  verdict.verdict !== 'abstain' && !/-timeout$|-error:/.test(verdict.reason);

/**
 * The model score behind a wake decision, for the owner to judge the decision by.
 *
 * Returns:
 * - the duty judge's score for an `in-duty` decision, since that is the one that woke the bot
 * - the routing model's for a decision routing made (Channel: chosen, unsure, or not chosen)
 * - otherwise the addressed classifier's, then the duty judge's, then routing's, whichever scored
 * - `undefined` when no model scored (an @-mention, a command, a rule, a failed call)
 */
export const pickWakeJudgeScore = (
  verdicts: readonly SignalDecisionVerdict[] | null | undefined,
  finalReason: string | null,
): BotWakeJudgeScore | undefined => {
  const scored = (verdicts ?? []).filter((v) => KIND_BY_POLICY[v.policyId] && isScored(v));
  const byKind = (kind: BotWakeJudgeKind) =>
    scored.find((v) => KIND_BY_POLICY[v.policyId] === kind);
  const order: BotWakeJudgeKind[] =
    finalReason === 'in-duty'
      ? ['duty', 'addressed', 'routing']
      : finalReason && ROUTING_REASONS.has(finalReason)
        ? ['routing', 'addressed', 'duty']
        : ['addressed', 'duty', 'routing'];

  for (const kind of order) {
    const verdict = byKind(kind);
    if (verdict) return { kind, score: verdict.confidence, verdict: verdict.verdict };
  }

  return undefined;
};
