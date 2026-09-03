import { GOAL_ACCEPTANCE_TASK_TITLE } from '@lobechat/const/goal';
import type { GoalGraphDecision } from '@lobechat/types';

import type { GoalNodeView } from './goalGraphViewModel';

/**
 * The goal coordinator authors its gate/attempt strings in English on the
 * server (`GoalService.openFailureDecision` and the verify settle reasons).
 * The option ids and reason templates are a stable, finite vocabulary, so the
 * client recognizes them and swaps in the user's language; anything it does
 * not recognize renders verbatim.
 */

export type CoordinatorGateKind = 'goalAcceptance' | 'recoverTask';

export interface LocalizedCopyRef {
  key: string;
  params?: Record<string, string>;
}

const idsOf = (decision?: GoalGraphDecision | null): Set<string> =>
  new Set((decision?.options ?? []).map((option) => option.id));

export const coordinatorGateKind = (
  decision?: GoalGraphDecision | null,
): CoordinatorGateKind | undefined => {
  const ids = idsOf(decision);
  if (ids.has('retry') && ids.has('retire')) return 'recoverTask';
  if (ids.has('retry') && ids.has('fail')) return 'goalAcceptance';
  return undefined;
};

/** The gate a node view carries — pending first, else the last human-resolved one. */
export const viewGateKind = (view: GoalNodeView): CoordinatorGateKind | undefined =>
  coordinatorGateKind(view.decision ?? view.humanTouches.at(-1));

export const gateTitleKey = (kind: CoordinatorGateKind): string => `goalProcess.gate.title.${kind}`;

/**
 * Locale key for a coordinator-authored fixed node title (gate nodes and the
 * terminal Goal-acceptance Work), or undefined for user/agent-authored nodes.
 */
export const coordinatorNodeTitleKey = (view: GoalNodeView): string | undefined => {
  const { node } = view;
  if (node.kind === 'task' && node.title === GOAL_ACCEPTANCE_TASK_TITLE)
    return 'goalProcess.node.terminalAcceptance';
  if (node.kind === 'decision') {
    const kind = viewGateKind(view);
    if (kind) return gateTitleKey(kind);
  }
  return undefined;
};

/** Strip the coordinator question template down to its dynamic reason half. */
const QUESTION_TAILS = [
  /\.?\s*Retry or retire this task node\?$/,
  /\.?\s*Retry Goal acceptance or fail this Goal\?$/,
];

export const coordinatorGateReason = (question?: string | null): string | undefined => {
  if (!question) return undefined;
  for (const tail of QUESTION_TAILS) {
    if (tail.test(question)) {
      const reason = question.replace(tail, '').trim();
      return reason || undefined;
    }
  }
  return question;
};

/** Known coordinator reason templates → chat-ns locale refs. */
const REASON_PATTERNS: Array<{
  key: string;
  param?: string;
  pattern: RegExp;
}> = [
  {
    key: 'goalProcess.gate.reason.verifyInternalError',
    pattern: /^Verification could not run \(internal error\); the delivery was not evaluated\.?$/,
  },
  {
    key: 'goalProcess.gate.reason.verifyFailed',
    param: 'id',
    pattern: /^Task (\S+) did not pass verification$/,
  },
  {
    key: 'goalProcess.gate.reason.goalAcceptanceFailed',
    pattern: /^Goal-level acceptance did not pass$/,
  },
  {
    key: 'goalProcess.gate.reason.attemptBudgetExhausted',
    pattern: /^Work attempt budget was exhausted( after an operation was abandoned)?$/,
  },
  {
    key: 'goalProcess.gate.reason.costBudgetExhausted',
    pattern: /^Goal cost budget was exhausted( after an operation was abandoned)?$/,
  },
  {
    key: 'goalProcess.gate.reason.recoveryFailed',
    pattern:
      /^Automatic recovery could not (start the next attempt|restart an abandoned operation)$/,
  },
];

export const coordinatorReasonCopy = (reason?: string | null): LocalizedCopyRef | undefined => {
  if (!reason) return undefined;
  const trimmed = reason.trim();
  for (const { key, param, pattern } of REASON_PATTERNS) {
    const match = pattern.exec(trimmed);
    if (match) return { key, ...(param && match[1] ? { params: { [param]: match[1] } } : {}) };
  }
  return undefined;
};
