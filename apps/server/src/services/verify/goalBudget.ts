import { DEFAULT_GOAL_MAX_ROUNDS } from '@lobechat/const/verify';
import type { TaskGoalConfig } from '@lobechat/types';

/**
 * Pure goal-budget helpers, dependency-free on purpose: both the outer loop
 * (verify/goalLoop → TaskRunnerService) and the prompt builder
 * (taskRunner/buildTaskPrompt) need them, and importing the loop service from
 * the prompt builder would create a taskRunner ⇄ verify module cycle.
 */

/**
 * Applied when the user left the round budget untouched. `null` in the config
 * means the user explicitly opted out of a cap — that maps to Infinity, not to
 * this default.
 *
 * Re-exported from `@lobechat/const/verify` so the create-goal UI and this loop
 * agree on one number; the const package is the single source of truth.
 */
export { DEFAULT_GOAL_MAX_ROUNDS };

/** Round budget: `null` = user opted out of a cap, absent = default. */
export const resolveGoalRoundBudget = (goal: TaskGoalConfig): number => {
  if (goal.maxIterations === null) return Number.POSITIVE_INFINITY;
  if (typeof goal.maxIterations === 'number') return Math.max(2, goal.maxIterations);
  return DEFAULT_GOAL_MAX_ROUNDS;
};
