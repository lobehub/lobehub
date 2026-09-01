import type { GoalStatus } from '@lobechat/const/goal';
import type { TaskStatus } from '@lobechat/types';

/** Goal lifecycle state → i18n status key (goal list vocabulary). */
const goalStatusKeyMap = {
  achieved: 'goalList.status.achieved',
  canceled: 'goalList.status.canceled',
  failed: 'goalList.status.error',
  paused: 'goalList.status.paused',
  planning: 'goalList.status.planning',
  review: 'goalList.status.review',
  running: 'goalList.status.running',
  verifying: 'goalList.status.verifying',
} as const satisfies Record<GoalStatus, string>;

export type GoalStatusKey = (typeof goalStatusKeyMap)[GoalStatus];

export const goalStatusKey = (status: GoalStatus): GoalStatusKey => goalStatusKeyMap[status];

/** `1h 23m` / `4m` — locale-neutral compact span for header metrics and drill-downs. */
export const formatSpan = (ms: number): string => {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

/** Goal lifecycle state → the execution-status vocabulary the shared glyphs use. */
export const goalStatusToTaskStatus = (goalStatus: GoalStatus): TaskStatus => {
  switch (goalStatus) {
    case 'achieved': {
      return 'completed';
    }
    case 'canceled': {
      return 'canceled';
    }
    case 'failed': {
      return 'failed';
    }
    case 'paused':
    case 'review': {
      return 'paused';
    }
    case 'planning': {
      return 'backlog';
    }
    default: {
      return 'running';
    }
  }
};
