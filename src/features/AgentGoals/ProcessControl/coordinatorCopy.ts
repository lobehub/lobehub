import {
  GOAL_ACCEPTANCE_TASK_TITLE,
  GOAL_BATCH_ASSAY_TITLE,
  GOAL_BATCH_TEMPLATE_TITLE,
  GOAL_BATCH_TITLE,
  GOAL_CLARIFICATION_OPTION,
  GOAL_MACHINE_GATE_TITLE,
  GOAL_MANAGER_QUESTION_TITLE,
} from '@lobechat/const/goal';
import type { GoalDecisionOption, GoalGraphDecision } from '@lobechat/types';
import {
  coordinatorGateReason,
  coordinatorReasonCopy,
  type LocalizedCopyRef,
} from '@lobechat/utils/goalCopy';

import type { GoalNodeView } from './goalGraphViewModel';

/**
 * The goal coordinator authors its gate/attempt strings in English on the
 * server (`GoalService.openFailureDecision` and the verify settle reasons).
 * The option ids and reason templates are a stable, finite vocabulary, so the
 * client recognizes them and swaps in the user's language; anything it does
 * not recognize renders verbatim.
 */

export type CoordinatorGateKind =
  'agentQuestion' | 'clarifyGoal' | 'fixSetup' | 'goalAcceptance' | 'recoverTask';

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
  // A batch's own nodes carry fixed English titles, like the gates below.
  if (node.kind === 'batch' && node.title === GOAL_BATCH_TITLE) return 'goalBatch.title';
  if (node.kind === 'finding' && node.title === GOAL_BATCH_TEMPLATE_TITLE)
    return 'goalBatch.templatePlain';
  if (node.kind === 'decision' && node.title === GOAL_BATCH_ASSAY_TITLE)
    return 'goalBatch.gate.title';
  if (node.kind === 'decision' && node.title === GOAL_MANAGER_QUESTION_TITLE)
    return gateTitleKey('agentQuestion');
  if (node.kind === 'decision') {
    const kind = viewGateKind(view);
    if (kind) return gateTitleKey(kind);
  }
  return undefined;
};

export { coordinatorGateReason, coordinatorReasonCopy, type LocalizedCopyRef };
