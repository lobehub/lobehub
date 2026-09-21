import type { GoalNodeStatus } from '@lobechat/types';

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
