import { useMemo } from 'react';

import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import { resolveTaskAcceptanceWait, type TaskAcceptanceWait } from './taskAcceptanceWait';

/** The acceptance round the active `running` task waits on, if its agent has stopped. */
export const useTaskAcceptanceWait = (): TaskAcceptanceWait | undefined => {
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const status = useTaskStore(taskDetailSelectors.activeTaskStatus);
  // The raw array keeps a stable reference between refreshes; the derived
  // topic list would not.
  const activities = useTaskStore((s) => taskDetailSelectors.activeTaskDetail(s)?.activities);

  return useMemo(() => {
    const topics = (activities ?? [])
      .filter((activity) => activity.type === 'topic')
      .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    return resolveTaskAcceptanceWait(status, topics, taskId);
  }, [activities, status, taskId]);
};
