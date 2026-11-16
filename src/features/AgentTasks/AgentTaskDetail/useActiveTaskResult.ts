import { useEffect } from 'react';

import { normalizeAsyncError } from '@/libs/swr/normalizeError';
import { useTaskStore } from '@/store/task';

interface ActiveTaskResultState {
  error?: unknown;
  isInitialLoading: boolean;
  isNotFound: boolean;
  onRetry: () => void;
}

/** Fetches only the Task snapshot needed by the result review surface. */
export const useActiveTaskResult = (taskId?: string): ActiveTaskResultState => {
  const claimActiveTask = useTaskStore((state) => state.claimActiveTask);
  const useFetchTaskDetail = useTaskStore((state) => state.useFetchTaskDetail);
  const hasTaskDetail = useTaskStore((state) =>
    taskId ? Boolean(state.taskDetailMap[state.taskRefIndex?.[taskId] ?? taskId]) : false,
  );

  // Claimed like the detail surfaces (see `useActiveTaskDetail`), so closing
  // the result hands the active task back to the page underneath.
  useEffect(() => {
    if (!taskId) return;
    return claimActiveTask(taskId);
  }, [claimActiveTask, taskId]);

  const { error: taskError, mutate } = useFetchTaskDetail(taskId);

  if (!taskId) return { isInitialLoading: false, isNotFound: false, onRetry: () => {} };

  const settledWithoutDetail = Boolean(taskError) && !hasTaskDetail;
  const isResolvedNotFound = normalizeAsyncError(taskError).code === 'TASK_NOT_FOUND';

  return {
    error: settledWithoutDetail && !isResolvedNotFound ? taskError : undefined,
    isInitialLoading: !hasTaskDetail && !settledWithoutDetail,
    isNotFound: settledWithoutDetail && isResolvedNotFound,
    onRetry: () => mutate(),
  };
};
