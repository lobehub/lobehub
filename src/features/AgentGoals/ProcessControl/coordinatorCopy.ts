import {
  GOAL_ACCEPTANCE_TASK_TITLE,
  GOAL_CLARIFICATION_OPTION,
  GOAL_MACHINE_GATE_TITLE,
} from '@lobechat/const/goal';
import type { GoalDecisionOption, GoalGraphDecision } from '@lobechat/types';

import type { GoalNodeView } from './goalGraphViewModel';

/**
 * The goal coordinator authors its gate/attempt strings in English on the
 * server (`GoalService.openFailureDecision` and the verify settle reasons).
 * The option ids and reason templates are a stable, finite vocabulary, so the
 * client recognizes them and swaps in the user's language; anything it does
 * not recognize renders verbatim.
 */

export type CoordinatorGateKind = 'clarifyGoal' | 'fixSetup' | 'goalAcceptance' | 'recoverTask';

export interface LocalizedCopyRef {
  key: string;
  params?: Record<string, string>;
}

const idsOf = (decision?: GoalGraphDecision | null): Set<string> =>
  new Set((decision?.options ?? []).map((option) => option.id));

export const coordinatorGateKind = (
  decision?: GoalGraphDecision | null,
  /** The gate node's title; the machine gate shares its options with `recoverTask`. */
  nodeTitle?: string | null,
): CoordinatorGateKind | undefined => {
  const ids = idsOf(decision);
  // `fail` only ever appears on the terminal acceptance gate, which may also
  // offer `retire` — check it first.
  if (ids.has('retry') && ids.has('fail')) return 'goalAcceptance';
  if (ids.has('retry') && ids.has('retire'))
    return nodeTitle === GOAL_MACHINE_GATE_TITLE ? 'fixSetup' : 'recoverTask';
  if (ids.has(GOAL_CLARIFICATION_OPTION.assume) && ids.has(GOAL_CLARIFICATION_OPTION.answer))
    return 'clarifyGoal';
  return undefined;
};

/** The gate a node view carries — pending first, else the last human-resolved one. */
export const viewGateKind = (view: GoalNodeView): CoordinatorGateKind | undefined =>
  coordinatorGateKind(view.decision ?? view.humanTouches.at(-1), view.node.title);

export const gateTitleKey = (kind: CoordinatorGateKind): string => `goalProcess.gate.title.${kind}`;

/**
 * Locale key for a coordinator gate option, or undefined for a planner-authored
 * option that keeps its stored label. The machine gate's Retry says the person
 * fixed something first.
 */
export const gateOptionLabelKey = (
  option: Pick<GoalDecisionOption, 'id'>,
  kind?: CoordinatorGateKind,
): string | undefined => {
  switch (option.id) {
    case 'fail': {
      return 'goalProcess.gate.option.fail';
    }
    case 'retire': {
      return 'goalProcess.gate.option.retire';
    }
    case 'retry': {
      return kind === 'fixSetup'
        ? 'goalProcess.gate.option.fixedRetry'
        : 'goalProcess.gate.option.retry';
    }
    default: {
      return undefined;
    }
  }
};

/** The coordinator's terminal Task that accepts the whole Goal (matched by its fixed title). */
export const isGoalAcceptanceTask = (view: GoalNodeView): boolean =>
  view.node.kind === 'task' && view.node.title === GOAL_ACCEPTANCE_TASK_TITLE;

/**
 * Locale key for a coordinator-authored fixed node title (gate nodes and the
 * terminal Goal-acceptance Task), or undefined for user/agent-authored nodes.
 */
export const coordinatorNodeTitleKey = (view: GoalNodeView): string | undefined => {
  const { node } = view;
  if (isGoalAcceptanceTask(view)) return 'goalProcess.node.terminalAcceptance';
  if (node.kind === 'decision') {
    const kind = viewGateKind(view);
    if (kind) return gateTitleKey(kind);
  }
  return undefined;
};

/** Strip the coordinator question template down to its dynamic reason half. */
const QUESTION_TAILS = [
  /\.?\s*Retry or retire this task node\?$/,
  /\.?\s*Fix it, then retry or retire this task node\?$/,
  /\.?\s*Retry Goal acceptance or fail this Goal\?$/,
  /\.?\s*Retry Goal acceptance, abandon it, or fail this Goal\?$/,
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
    pattern: /^Task attempt budget was exhausted( after an operation was abandoned)?$/,
  },
  {
    key: 'goalProcess.gate.reason.costBudgetExhausted',
    pattern: /^Goal cost budget was exhausted( after an operation was abandoned)?$/,
  },
  {
    key: 'goalProcess.gate.reason.deviceStayedOffline',
    pattern: /^Task device stayed offline$/,
  },
  {
    key: 'goalProcess.gate.reason.recoveryFailed',
    pattern:
      /^Automatic recovery could not (start the next attempt|restart an abandoned operation)$/,
  },
  {
    // A run that failed outright leaves its runtime error type as the reason
    // (e.g. `InvalidProviderAPIKey`). The code stays visible for support; the
    // sentence around it is the user's language.
    key: 'goalProcess.gate.reason.runError',
    param: 'code',
    pattern: /^([A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*)$/,
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
