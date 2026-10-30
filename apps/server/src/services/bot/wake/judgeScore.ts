import type { SignalDecisionVerdict } from '@lobechat/types';

import { CLASSIFIER_POLICY_ID } from '@/server/services/agentSignal/scenarios/botWake/policies/classifier';
import { DUTY_POLICY_ID } from '@/server/services/agentSignal/scenarios/botWake/policies/duty';

/** Which model judged: is the message for the bot (`addressed`), or within its duties (`duty`). */
export type WakeJudgeKind = 'addressed' | 'duty';

export interface WakeJudgeScore {
  kind: WakeJudgeKind;
  /** 0..1, as the judge returned it. */
  score: number;
  verdict: SignalDecisionVerdict['verdict'];
}

const KIND_BY_POLICY: Record<string, WakeJudgeKind> = {
  [CLASSIFIER_POLICY_ID]: 'addressed',
  [DUTY_POLICY_ID]: 'duty',
};

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
 * - otherwise the addressed classifier's, then the duty judge's, whichever scored
 * - `undefined` when no model scored (an @-mention, a command, a rule, a failed call)
 */
export const pickWakeJudgeScore = (
  verdicts: readonly SignalDecisionVerdict[] | null | undefined,
  finalReason: string | null,
): WakeJudgeScore | undefined => {
  const scored = (verdicts ?? []).filter((v) => KIND_BY_POLICY[v.policyId] && isScored(v));
  const byKind = (kind: WakeJudgeKind) => scored.find((v) => KIND_BY_POLICY[v.policyId] === kind);
  const order: WakeJudgeKind[] =
    finalReason === 'in-duty' ? ['duty', 'addressed'] : ['addressed', 'duty'];

  for (const kind of order) {
    const verdict = byKind(kind);
    if (verdict) return { kind, score: verdict.confidence, verdict: verdict.verdict };
  }

  return undefined;
};
