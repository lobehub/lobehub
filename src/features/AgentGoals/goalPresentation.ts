export interface GoalPresentationInput {
  acceptanceStatus?: string;
  checks?: Array<{ state: string }>;
  maxRounds?: number | null;
  rounds: number;
  taskStatus: string;
}

const acceptanceStatusKey = (status?: string) => {
  switch (status) {
    case 'accepted': {
      return 'goalList.status.achieved';
    }
    case 'closed':
    case 'rejected': {
      return 'goalList.status.paused';
    }
    case 'delivered': {
      return 'goalList.status.review';
    }
    case 'errored': {
      return 'goalList.status.error';
    }
    case 'planned':
    case 'repairing':
    case 'verifying': {
      return 'goalList.status.verifying';
    }
    default: {
      return undefined;
    }
  }
};

const taskStatusKey = (status: string) => {
  switch (status) {
    case 'backlog': {
      return 'goalList.status.planning';
    }
    case 'completed': {
      return 'goalList.status.review';
    }
    case 'failed': {
      return 'goalList.status.error';
    }
    case 'paused': {
      return 'goalList.status.paused';
    }
    case 'canceled': {
      return 'goalList.status.canceled';
    }
    case 'scheduled': {
      return 'goalList.status.waiting';
    }
    default: {
      return 'goalList.status.running';
    }
  }
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
    statusKey: acceptanceStatusKey(input.acceptanceStatus) ?? taskStatusKey(input.taskStatus),
    total,
  };
};
