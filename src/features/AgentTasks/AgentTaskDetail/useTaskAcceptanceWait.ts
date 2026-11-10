import type { TaskDetailActivity } from '@lobechat/types';
import { useMemo } from 'react';

import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import {
  resolveRunAcceptanceWaitInTask,
  resolveTaskAcceptanceWait,
  type TaskAcceptanceWait,
} from './taskAcceptanceWait';

/** The acceptance round the active `running` task waits on, if its agent has stopped. */
export const useTaskAcceptanceWait = (): TaskAcceptanceWait | undefined => {
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const status = useTaskStore(taskDetailSelectors.activeTaskStatus);
  // The raw array keeps a stable reference between refreshes; the derived
  // topic list would not.
  const activities = useTaskStore((s) => taskDetailSelectors.activeTaskDetail(s)?.activities);

  return useMemo(
    () =>
      resolveTaskAcceptanceWait(
        status,
        (activities ?? []).filter((activity) => activity.type === 'topic'),
        taskId,
      ),
    [activities, status, taskId],
  );
};

/** The acceptance round one run holds its owning task in, if any. */
export const useRunAcceptanceWait = (
  run: Pick<TaskDetailActivity, 'id' | 'sourceTaskId'> | undefined,
): TaskAcceptanceWait | undefined => {
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const detail = useTaskStore(taskDetailSelectors.activeTaskDetail);
  const runId = run?.id;
  const sourceTaskId = run?.sourceTaskId;

  return useMemo(
    () =>
      runId
        ? resolveRunAcceptanceWaitInTask(detail, taskId, { id: runId, sourceTaskId })
        : undefined,
    [detail, runId, sourceTaskId, taskId],
  );
};
