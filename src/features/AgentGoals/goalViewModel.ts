import type { GoalStatus } from '@lobechat/const/goal';
import type { TaskDetailActivity } from '@lobechat/types';

interface GoalDescriptionSource {
  description?: string | null;
  instruction: string;
}

export const getGoalDescription = ({ description, instruction }: GoalDescriptionSource) =>
  description?.trim() || instruction.trim();

export const getGoalRuns = (activities?: TaskDetailActivity[]) =>
  activities?.filter((activity) => activity.type === 'topic').toReversed() ?? [];

export const getRecentGoalRuns = (activities?: TaskDetailActivity[], limit = 10) =>
  getGoalRuns(activities).slice(0, limit);

export const formatGoalDuration = (milliseconds: number) => {
  if (milliseconds <= 0) return '—';
  const totalMinutes = Math.max(1, Math.round(milliseconds / 60_000));
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
};

export const formatGoalCost = (cost: number) =>
  cost > 0 ? `$${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2)}` : '—';

export const getGoalRunMetrics = (activities?: TaskDetailActivity[]) =>
  getGoalRuns(activities).reduce(
    (metrics, activity) => {
      const startedAt = activity.time ? new Date(activity.time).getTime() : Number.NaN;
      const completedAt = activity.completedAt
        ? new Date(activity.completedAt).getTime()
        : Number.NaN;
      const duration = completedAt - startedAt;

      return {
        cost: metrics.cost + (activity.cost ?? 0),
        duration: metrics.duration + (Number.isFinite(duration) && duration > 0 ? duration : 0),
      };
    },
    { cost: 0, duration: 0 },
  );

export const shouldShowGoal = (goalStatus: GoalStatus, filter: 'active' | 'all') =>
  filter === 'all' || goalStatus !== 'achieved';

export const goalStatusToTaskStatus = (goalStatus: GoalStatus) => {
  switch (goalStatus) {
    case 'achieved': {
      return 'completed';
    }
    case 'failed': {
      return 'failed';
    }
    case 'canceled': {
      return 'canceled';
    }
    case 'paused':
    case 'review': {
      return 'paused';
    }
    case 'planning': {
      return 'backlog';
    }
    case 'verifying': {
      return 'running';
    }
    default: {
      return 'running';
    }
  }
};
