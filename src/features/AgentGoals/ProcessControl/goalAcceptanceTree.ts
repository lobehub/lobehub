import type { AcceptanceStatus, VerifyCheckTally } from '@lobechat/types';

import { isGoalAcceptanceTask } from './coordinatorCopy';
import type { GoalGraphView, GoalNodeView } from './goalGraphViewModel';
import { findGoalAcceptanceView, isGoalReportTaskView } from './goalResultState';

/**
 * Where a level in the acceptance hierarchy stands.
 *
 * A level's state is always its OWN acceptance status — never a roll-up of the
 * levels under it. The goal-level acceptance and a task's acceptance are
 * independent judgments, so deriving one from the other would state a rule the
 * product never decided and let the tree contradict the page header above it.
 */
export type AcceptanceLevelState =
  'awaitingSignOff' | 'closed' | 'inProgress' | 'rejected' | 'signedOff' | 'unavailable';

/**
 * The acceptance lifecycle, folded onto what a reviewer needs to do about it.
 *
 * `delivered` and `errored` land together on purpose: a settled round and an
 * inconclusive one both wait on the owner, and the decision strip the tree sits
 * above treats them the same way.
 */
const LEVEL_STATE_BY_STATUS: Record<AcceptanceStatus, AcceptanceLevelState> = {
  accepted: 'signedOff',
  closed: 'closed',
  delivered: 'awaitingSignOff',
  errored: 'awaitingSignOff',
  pending: 'inProgress',
  planned: 'inProgress',
  rejected: 'rejected',
  repairing: 'inProgress',
  verifying: 'inProgress',
};

export interface AcceptanceLevel {
  /** The acceptance behind this level; absent when the node has none yet. */
  acceptanceId?: string;
  /** The acceptance's current round, counted. Absent when it has no round yet. */
  checks?: VerifyCheckTally;
  /** Stable key for expansion state — the node id. */
  key: string;
  node: GoalNodeView;
  state: AcceptanceLevelState;
}

export interface AcceptanceTree {
  /**
   * The goal-level acceptance — the one sign-off acts on. Absent until the
   * terminal acceptance task exists.
   */
  goal?: AcceptanceLevel;
  /**
   * The work tasks' own acceptances, in the order the graph numbers its tasks.
   * A task that was never dispatched has no acceptance and still appears, as
   * `unavailable` — "nothing verified this" must not read as "this passed".
   */
  tasks: AcceptanceLevel[];
}

const levelOf = (view: GoalNodeView, key: string): AcceptanceLevel => {
  const { acceptance } = view;
  if (!acceptance) return { key, node: view, state: 'unavailable' };

  return {
    acceptanceId: acceptance.id,
    ...(acceptance.checks ? { checks: acceptance.checks } : {}),
    key,
    node: view,
    state: LEVEL_STATE_BY_STATUS[acceptance.status] ?? 'inProgress',
  };
};

/**
 * The Goal's acceptances as one hierarchy: the goal-level acceptance over the
 * acceptances of the tasks that were dispatched to serve it.
 *
 * The relation already exists in the graph — the terminal Goal-acceptance task
 * and the work tasks are nodes of the same graph — so this only reads it out.
 * Every level is generated from what the graph snapshot already carries; no
 * level is inferred from another level's result.
 */
export const buildAcceptanceTree = (graph: GoalGraphView): AcceptanceTree => {
  const goalView = findGoalAcceptanceView(graph);
  const taskViews = graph.nodes.filter(
    (view) =>
      view.node.kind === 'task' &&
      !isGoalAcceptanceTask(view) &&
      !isGoalReportTaskView(graph, view),
  );

  return {
    ...(goalView ? { goal: levelOf(goalView, goalView.node.id) } : {}),
    tasks: taskViews.map((view) => levelOf(view, view.node.id)),
  };
};

/**
 * Whether the tree has anything to draw.
 *
 * Counts the levels the page can name, not their verdicts: a goal whose
 * acceptance exists but has not run yet has a hierarchy worth showing — every
 * level simply reads as still in progress.
 */
export const hasAcceptanceTree = (tree: AcceptanceTree): boolean =>
  Boolean(tree.goal) || tree.tasks.length > 0;
