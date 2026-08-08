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
 */
export const DEFAULT_GOAL_MAX_ROUNDS = 3;

/** Round budget: `null` = user opted out of a cap, absent = default. */
export const resolveGoalRoundBudget = (goal: TaskGoalConfig): number => {
  if (goal.maxIterations === null) return Number.POSITIVE_INFINITY;
  if (typeof goal.maxIterations === 'number') return Math.max(2, goal.maxIterations);
  return DEFAULT_GOAL_MAX_ROUNDS;
};
