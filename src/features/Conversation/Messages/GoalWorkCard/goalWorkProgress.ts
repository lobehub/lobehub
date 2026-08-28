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
  acceptanceStatus?: string;
  checks?: Array<{ state: string }>;
  criteriaCount: number;
  maxRounds?: number | null;
  rounds?: number;
  taskStatus?: string;
}

const resolvePhase = (acceptanceStatus?: string, taskStatus?: string): GoalWorkPhase => {
  switch (acceptanceStatus) {
    case 'accepted': {
      return 'achieved';
    }
    case 'delivered': {
      return 'review';
    }
    case 'errored': {
      return 'error';
    }
    case 'rejected':
    case 'closed': {
      return 'paused';
    }
    case 'repairing': {
      return 'repairing';
    }
    case 'verifying': {
      return 'verifying';
    }
  }

  switch (taskStatus) {
    case 'canceled': {
      return 'canceled';
    }
    case 'failed': {
      return 'error';
    }
    case 'paused': {
      return 'paused';
    }
    case 'scheduled': {
      return 'waiting';
    }
    default: {
      return 'running';
    }
  }
};

/** Honest Goal progress: lifecycle phase + round budget + acceptance coverage. */
export const getGoalWorkProgress = (input: GoalWorkProgressInput) => {
  const checks = input.checks ?? [];
  const passed = checks.filter((check) => check.state === 'passed').length;
  const total = checks.length || input.criteriaCount;

  return {
    maxRounds: input.maxRounds ?? undefined,
    passed,
    phase: resolvePhase(input.acceptanceStatus, input.taskStatus),
    progress: total > 0 ? Math.round((passed / total) * 100) : 0,
    round: Math.max(1, input.rounds ?? 1),
    total,
  };
};
