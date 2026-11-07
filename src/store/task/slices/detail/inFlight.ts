import type { TaskDetailData, TaskDetailSubtask } from '@lobechat/types';

export const TASK_DETAIL_POLL_INTERVAL = 10_000;

const hasInFlightSubtask = (subtasks: TaskDetailSubtask[] | undefined): boolean =>
  subtasks?.some(
    (subtask) =>
      Boolean(subtask.runningTopic) ||
      subtask.status === 'running' ||
      subtask.status === 'pending' ||
      hasInFlightSubtask(subtask.children),
  ) ?? false;

// Poll while the task itself or any topic activity is still in flight, so the
// UI picks up status transitions (running → completed/failed) without needing
// a manual refresh. Returns false once everything settles so SWR stops polling.
export const hasInFlightActivity = (detail: TaskDetailData | undefined): boolean => {
  if (!detail) return false;
  if (detail.status === 'running' || detail.status === 'pending') return true;
  if (hasInFlightSubtask(detail.subtasks)) return true;
  return (
    detail.activities?.some(
      (a) => a.type === 'topic' && (a.status === 'running' || a.status === 'pending'),
    ) ?? false
  );
};
