import type { TaskContext, TaskDetailData, TaskItem } from '@lobechat/types';

const toIso = (value: Date | string | null | undefined) =>
  value ? new Date(value).toISOString() : null;

/** Automation and archive fields of a task's detail view, projected from its row. */
export const projectTaskDetailState = (
  task: TaskItem,
  taskConfig: Record<string, unknown> | undefined,
): Pick<TaskDetailData, 'archivedAt' | 'heartbeat' | 'schedule'> => {
  const taskContext = task.context ? (task.context as TaskContext) : undefined;
  const scheduleConfig = (taskConfig?.schedule ?? {}) as { maxExecutions?: number | null };

  return {
    archivedAt: toIso(task.archivedAt),
    heartbeat:
      task.heartbeatInterval || task.heartbeatTimeout || task.lastHeartbeatAt
        ? {
            interval: task.heartbeatInterval,
            lastAt: toIso(task.lastHeartbeatAt),
            scheduledAt: taskContext?.scheduler?.scheduledAt,
            timeout: task.heartbeatTimeout,
          }
        : undefined,
    schedule:
      task.schedulePattern || task.scheduleTimezone || scheduleConfig.maxExecutions != null
        ? {
            maxExecutions: scheduleConfig.maxExecutions ?? null,
            pattern: task.schedulePattern,
            timezone: task.scheduleTimezone,
          }
        : undefined,
  };
};
