import type { GoalNodeStatus, GoalRolloutPhase } from '@lobechat/types';

import { TASK_STATUS_VISUALS } from '@/components/ExecutionStatus';

/** A container describes its work; it is not itself a running Task. */
export const experimentStatusVisual = (status: GoalNodeStatus) => {
  const visuals = {
    active: TASK_STATUS_VISUALS.running,
    proposed: TASK_STATUS_VISUALS.backlog,
    rejected: TASK_STATUS_VISUALS.failed,
    resolved: TASK_STATUS_VISUALS.completed,
    retired: TASK_STATUS_VISUALS.canceled,
    waiting: TASK_STATUS_VISUALS.paused,
  };
  return visuals[status];
};

/**
 * What an open batch is doing, from its rollout phase. The batch node itself
 * is created `proposed` and never moves, so its own status says nothing.
 */
export const batchContainerStatus = (phase?: GoalRolloutPhase): GoalNodeStatus | undefined => {
  switch (phase) {
    case 'done': {
      return 'resolved';
    }
    case 'pattern_break':
    case 'release_review': {
      return 'waiting';
    }
    case 'plan_distill':
    case 'plan_revision':
    case 'probe':
    case 'mass': {
      return 'active';
    }
    default: {
      return undefined;
    }
  }
};
