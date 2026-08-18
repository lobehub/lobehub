export interface GoalPresentationInput {
  acceptanceStatus?: string;
  checks?: Array<{ state: string }>;
  /** The goal entity's own lifecycle state (`goals.status`), when loaded. */
  goalStatus?: string;
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
    // `planned` deliberately falls through to the goal/task tiers: the verify
    // plan is confirmed at RUN START, so this phase spans the whole executing
    // round — showing 验证中 for it misreads an executing goal as verifying.
    case 'repairing':
    case 'verifying': {
      return 'goalList.status.verifying';
    }
    default: {
      return undefined;
    }
  }
};

/**
 * `goals.status` is the server-written goal state machine — a direct 1:1 onto
 * the display vocabulary (only `failed` renders through the `error` key). It
 * sits between the live acceptance phase (fresher, refetched per subject) and
 * the task-status heuristic (coarsest, kept as the final fallback).
 */
const goalStatusKey = (status?: string) => {
  switch (status) {
    case 'achieved':
    case 'canceled':
    case 'paused':
    case 'planning':
    case 'review':
    case 'running':
    case 'verifying': {
      return `goalList.status.${status}`;
    }
    case 'failed': {
      return 'goalList.status.error';
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
    statusKey:
      acceptanceStatusKey(input.acceptanceStatus) ??
      goalStatusKey(input.goalStatus) ??
      taskStatusKey(input.taskStatus),
    total,
  };
};
