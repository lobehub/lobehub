import type { GoalStatus } from '@lobechat/const/goal';

export interface GoalPresentationInput {
  checks?: Array<{ state: string }>;
  goalStatus: GoalStatus;
  maxRounds?: number | null;
  rounds: number;
}

/** Goal lifecycle state → i18n status key (goal list vocabulary). */
const goalStatusKeyMap: Record<GoalStatus, string> = {
  achieved: 'goalList.status.achieved',
  canceled: 'goalList.status.canceled',
  failed: 'goalList.status.error',
  paused: 'goalList.status.paused',
  planning: 'goalList.status.planning',
  review: 'goalList.status.review',
  running: 'goalList.status.running',
  verifying: 'goalList.status.verifying',
};

export const getGoalPresentation = (input: GoalPresentationInput) => {
  const checks = input.checks ?? [];
  const passed = checks.filter((check) => check.state === 'passed').length;
  const total = checks.length;

  return {
    maxRounds: input.maxRounds,
    passed,
    progress: total > 0 ? Math.round((passed / total) * 100) : 0,
    rounds: input.rounds,
    statusKey: goalStatusKeyMap[input.goalStatus],
    total,
  };
};
