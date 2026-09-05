import type { GoalStatus } from '@lobechat/const/goal';
import type { GoalSpend, TaskStatus } from '@lobechat/types';

/** Goal lifecycle state → i18n status key (goal list vocabulary). */
const goalStatusKeyMap = {
  achieved: 'goalList.status.achieved',
  canceled: 'goalList.status.canceled',
  failed: 'goalList.status.error',
  paused: 'goalList.status.paused',
  planning: 'goalList.status.planning',
  review: 'goalList.status.review',
  running: 'goalList.status.running',
  verifying: 'goalList.status.verifying',
} as const satisfies Record<GoalStatus, string>;

export type GoalStatusKey = (typeof goalStatusKeyMap)[GoalStatus];

export const goalStatusKey = (status: GoalStatus): GoalStatusKey => goalStatusKeyMap[status];

/** `1h 23m` / `4m` — locale-neutral compact span for header metrics and drill-downs. */
export const formatSpan = (ms: number): string => {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

/** Goal lifecycle state → the execution-status vocabulary the shared glyphs use. */
export const goalStatusToTaskStatus = (goalStatus: GoalStatus): TaskStatus => {
  switch (goalStatus) {
    case 'achieved': {
      return 'completed';
    }
    case 'canceled': {
      return 'canceled';
    }
    case 'failed': {
      return 'failed';
    }
    case 'paused':
    case 'review': {
      return 'paused';
    }
    case 'planning': {
      return 'backlog';
    }
    default: {
      return 'running';
    }
  }
};

/** `$6.4` — a budget read as money, at the precision a budget is set in. */
export const formatUsd = (amount: number): string => `$${Math.round(amount * 100) / 100}`;

/**
 * Spend and budget as ONE metric — they are a fraction, and two neighbouring
 * cards made the reader do the division.
 *
 * The fraction is always stated in the unit the budget is actually capped in.
 * A goal capped in rounds would otherwise read "$6.4 / 5 rounds", which is two
 * units wearing the costume of a ratio; there the rounds are the meaningful
 * numerator and the dollars move into the drill-down.
 */
export type GoalBudgetSummary =
  | { cap: number; kind: 'cost'; spent: number }
  | { cap: number; kind: 'rounds'; runs: number }
  | { kind: 'uncapped'; spent: number };

export const summarizeGoalBudget = (
  goal: { maxRounds: number | null; maxTotalCost: number | null },
  spend?: Pick<GoalSpend, 'runs' | 'totalCost'>,
): GoalBudgetSummary => {
  // An unfetched spend is 0 rather than unknown: the graph read that carries
  // the budget carries the spend with it, so the pair is never half-loaded.
  const { runs = 0, totalCost = 0 } = spend ?? {};

  if (goal.maxTotalCost !== null) return { cap: goal.maxTotalCost, kind: 'cost', spent: totalCost };
  if (goal.maxRounds !== null) return { cap: goal.maxRounds, kind: 'rounds', runs };
  return { kind: 'uncapped', spent: totalCost };
};
