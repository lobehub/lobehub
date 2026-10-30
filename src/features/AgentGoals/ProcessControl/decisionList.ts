import { GOAL_CLARIFICATION_OPTION } from '@lobechat/const/goal';
import type { GoalGraphDecision } from '@lobechat/types';

import type { UserDecisionView } from './goalResultState';

/**
 * Who a decision row belongs to:
 * - `pending` — still waiting for an answer
 * - `user`    — a person settled it
 * - `agent`   — an agent settled it on its own authority
 * - `system`  — settled with no recorded decider (the run environment)
 */
export type DecisionActor = 'agent' | 'pending' | 'system' | 'user';

export interface DecisionRow extends UserDecisionView {
  actor: DecisionActor;
  /** Extra guidance written alongside a picked option; absent when the words *are* the answer. */
  note?: string;
}

const actorOf = (decision: GoalGraphDecision): DecisionActor => {
  if (decision.status === 'pending') return 'pending';
  if (decision.resolvedByUserId) return 'user';
  if (decision.resolvedByAgentId) return 'agent';
  return 'system';
};

/**
 * Every call this Goal asked for, newest first with the open ones on top — the
 * trace of who decided what, not only what the owner decided. A canceled gate
 * decided nothing, so it is not a decision.
 */
export const buildDecisionRows = (decisions: GoalGraphDecision[]): DecisionRow[] => {
  const rows = decisions
    .filter((decision) => decision.status !== 'canceled')
    .map((decision): DecisionRow => {
      const option = decision.options?.find((item) => item.id === decision.resolvedOptionId);
      const words = decision.resolution?.trim() || undefined;
      // The free-text option has no wording of its own: the note is the answer.
      const answered = decision.resolvedOptionId === GOAL_CLARIFICATION_OPTION.answer;
      const choice = answered ? words : (option?.label ?? words);
      const note = !answered && option ? words : undefined;
      const at = decision.status === 'pending' ? undefined : (decision.resolvedAt ?? undefined);

      return {
        actor: actorOf(decision),
        ...(choice ? { choice } : {}),
        decision,
        ...(note ? { note } : {}),
        question: decision.question,
        ...(at ? { resolvedAt: at } : {}),
      };
    });

  const stamp = (row: DecisionRow) => (row.resolvedAt ?? row.decision.createdAt)?.getTime?.() ?? 0;

  return rows.sort((a, b) => {
    const open = Number(b.actor === 'pending') - Number(a.actor === 'pending');
    return open || stamp(b) - stamp(a);
  });
};
