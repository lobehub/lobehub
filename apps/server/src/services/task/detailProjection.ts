import type { TaskContext, TaskDetailData, TaskItem } from '@lobechat/types';
import { readTaskChannelDelivery, TASK_AUTOMATION_FAILURE_FUSE } from '@lobechat/types';

const toIso = (value: Date | string | null | undefined) =>
  value ? new Date(value).toISOString() : null;

/** Automation and archive fields of a task's detail view, projected from its row. */
export const projectTaskDetailState = (
  task: TaskItem,
  taskConfig: Record<string, unknown> | undefined,
): Pick<
  TaskDetailData,
  'archivedAt' | 'channelDelivery' | 'fusePause' | 'heartbeat' | 'schedule'
> => {
  const taskContext = task.context ? (task.context as TaskContext) : undefined;
  const scheduleConfig = (taskConfig?.schedule ?? {}) as { maxExecutions?: number | null };
  const delivery = readTaskChannelDelivery(taskConfig);
  const deliveryError = taskContext?.delivery?.lastError;
  // Only a schedule pauses on the fuse (a heartbeat stops re-arming instead),
  // and only while it is still paused: a manual pause after a resume is not it.
  const consecutiveFailures = taskContext?.scheduler?.consecutiveFailures ?? 0;
  const fusePaused =
    task.automationMode === 'schedule' &&
    task.status === 'paused' &&
    consecutiveFailures >= TASK_AUTOMATION_FAILURE_FUSE;

  return {
    archivedAt: toIso(task.archivedAt),
    channelDelivery: delivery && {
      ...delivery,
      ...(deliveryError && { lastError: deliveryError }),
    },
    fusePause: fusePaused
      ? { cause: taskContext?.scheduler?.pauseCause ?? null, consecutiveFailures }
      : null,
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
