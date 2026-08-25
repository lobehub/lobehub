import type { GoalItem } from '@lobechat/types';

import { resolveGoalRoundBudget } from '@/server/services/verify/goalBudget';

const DEFAULT_MAX_ATTEMPTS_PER_WORK = 3;

export const resolveWorkAttemptBudget = (goal: GoalItem, taskCarried: boolean): number => {
  const configured = goal.config?.recovery?.maxAttemptsPerWork;
  if (typeof configured === 'number') return Math.max(1, configured);
  return taskCarried ? resolveGoalRoundBudget(goal) : DEFAULT_MAX_ATTEMPTS_PER_WORK;
};

export const resolveWorkMaxSteps = (goal: GoalItem): number | undefined => {
  const configured = goal.config?.recovery?.maxStepsPerRun;
  return typeof configured === 'number' && configured > 0 ? configured : undefined;
};
