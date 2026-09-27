import type { GoalStatus } from '@lobechat/const/goal';
import type { GoalNodeStatus } from '@lobechat/types';

export type GoalTaskPhase =
  | 'achieved'
  | 'canceled'
  | 'error'
  | 'paused'
  | 'repairing'
  | 'review'
  | 'running'
  | 'verifying'
  | 'waiting';

interface GoalTaskProgressInput {
  criteriaCount: number;
  /** Decision gates waiting on a human right now — they outrank the goal's own status. */
  pendingDecisions?: number;
  status?: GoalStatus;
  taskDone?: number;
  taskTotal?: number;
}

const resolvePhase = (status?: GoalStatus, pendingDecisions = 0): GoalTaskPhase => {
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
 * of the graph's Tasks are closed. The criteria count is only a fallback for a
 * goal whose graph has not been seeded yet.
 */
export const getGoalTaskProgress = (input: GoalTaskProgressInput) => {
  const total = input.taskTotal || input.criteriaCount;
  const passed = input.taskDone ?? 0;

  return {
    passed,
    phase: resolvePhase(input.status, input.pendingDecisions),
    progress: total > 0 ? Math.round((passed / total) * 100) : 0,
    total,
  };
};

export type GoalStepState = 'active' | 'done' | 'pending';

export interface GoalStep {
  status: GoalNodeStatus;
  title: string;
}

const CLOSED_NODE_STATUSES = new Set<GoalNodeStatus>(['rejected', 'resolved', 'retired']);

export const toGoalStepState = (status: GoalNodeStatus): GoalStepState => {
  if (CLOSED_NODE_STATUSES.has(status)) return 'done';
  if (status === 'active') return 'active';
  return 'pending';
};

/** A chat card can show at most this many step segments before they stop reading as steps. */
export const MAX_GOAL_STEP_SEGMENTS = 12;

/**
 * One track segment per Task so the card reads as a plan of steps instead of one
 * anonymous bar. Graphs longer than the segment cap are sliced evenly; a slice
 * keeps the least advanced state it contains (pending < active < done), so the
 * fill still advances left to right and never overstates progress.
 */
export const buildGoalStepSegments = (statuses: GoalNodeStatus[]): GoalStepState[] => {
  const states = statuses.map(toGoalStepState);
  if (states.length <= MAX_GOAL_STEP_SEGMENTS) return states;

  const perSegment = Math.ceil(states.length / MAX_GOAL_STEP_SEGMENTS);
  const segments: GoalStepState[] = [];
  for (let start = 0; start < states.length; start += perSegment) {
    const slice = states.slice(start, start + perSegment);
    segments.push(
      slice.includes('pending') ? 'pending' : slice.includes('active') ? 'active' : 'done',
    );
  }
  return segments;
};

export interface GoalStepPointer {
  kind: 'current' | 'next';
  title: string;
}

/**
 * The step the card should point at: the first active Task while one runs, else
 * the first not-yet-closed Task as what's up next. Terminal phases have no
 * pointer — the phase word already says the outcome.
 */
export const getGoalStepPointer = (
  steps: GoalStep[],
  phase: GoalTaskPhase,
): GoalStepPointer | undefined => {
  if (['achieved', 'canceled', 'error'].includes(phase)) return undefined;

  const active = steps.find((step) => step.status === 'active');
  if (active) return { kind: 'current', title: active.title };

  const next = steps.find((step) => !CLOSED_NODE_STATUSES.has(step.status));
  return next ? { kind: 'next', title: next.title } : undefined;
};
