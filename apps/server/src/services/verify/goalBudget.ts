import { DEFAULT_GOAL_MAX_ROUNDS } from '@lobechat/const/verify';
import type { GoalItem } from '@lobechat/types';

/**
 * Pure goal-budget helpers, dependency-free on purpose: both the outer loop
 * (verify/goalLoop → TaskRunnerService) and the prompt builder
 * (taskRunner/buildTaskPrompt) need them, and importing the loop service from
 * the prompt builder would create a taskRunner ⇄ verify module cycle.
 */

/**
 * Applied at goal creation when the user left the round budget untouched
 * (`goals.max_rounds` is resolved at write time; `null` in the row means the
 * user explicitly opted out of a cap).
 *
 * Re-exported from `@lobechat/const/verify` so the create-goal UI and this loop
 * agree on one number; the const package is the single source of truth.
 */
export { DEFAULT_GOAL_MAX_ROUNDS };

/** Round budget: `null` = user opted out of a cap. */
export const resolveGoalRoundBudget = (goal: Pick<GoalItem, 'maxRounds'>): number => {
  if (typeof goal.maxRounds === 'number') return Math.max(2, goal.maxRounds);
  return Number.POSITIVE_INFINITY;
};
