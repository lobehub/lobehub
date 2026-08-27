import type { GoalStatus } from '@lobechat/const/goal';

export type GoalWorkPhase =
  | 'achieved'
  | 'canceled'
  | 'error'
  | 'paused'
  | 'repairing'
  | 'review'
  | 'running'
  | 'verifying'
  | 'waiting';

interface GoalWorkProgressInput {
  criteriaCount: number;
  /** Decision gates waiting on a human right now — they outrank the goal's own status. */
  pendingDecisions?: number;
  status?: GoalStatus;
  workDone?: number;
  workTotal?: number;
}

const resolvePhase = (status?: GoalStatus, pendingDecisions = 0): GoalWorkPhase => {
  if (pendingDecisions > 0) return 'waiting';
  switch (status) {
    case 'achieved': {
      return 'achieved';
    }
    case 'canceled': {
      return 'canceled';
    }
    case 'failed': {
      return 'error';
    }
    case 'paused': {
      return 'paused';
    }
    case 'review': {
      return 'review';
    }
    case 'verifying': {
      return 'verifying';
    }
    default: {
      return 'running';
    }
  }
};

/**
 * Honest Goal progress for the conversation card: lifecycle phase plus how much
 * of the graph's Work is closed. The criteria count is only a fallback for a
 * goal whose graph has not been seeded yet.
 */
export const getGoalWorkProgress = (input: GoalWorkProgressInput) => {
  const total = input.workTotal || input.criteriaCount;
  const passed = input.workDone ?? 0;

  return {
    passed,
    phase: resolvePhase(input.status, input.pendingDecisions),
    progress: total > 0 ? Math.round((passed / total) * 100) : 0,
    total,
  };
};
