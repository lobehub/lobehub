import { AsyncTaskStatus } from '@lobechat/types';
import { useEffect } from 'react';

import { useClientDataSWR } from '@/libs/swr';
import { type MemoryExtractionTask } from '@/services/userMemory/extraction';
import { memoryExtractionService } from '@/services/userMemory/extraction';

const SWR_KEY = 'user-memory:analysis-task';

export const useMemoryAnalysisAsyncTask = (taskId?: string) => {
  const swr = useClientDataSWR<MemoryExtractionTask | null>(
    taskId ? [SWR_KEY, taskId] : SWR_KEY,
    () => memoryExtractionService.getTask(taskId),
    {
      refreshInterval: (data) =>
        data && [AsyncTaskStatus.Pending, AsyncTaskStatus.Processing].includes(data.status)
          ? 30_000
          : 0,
    },
  );

  useEffect(() => {
    if (!swr.data) return;

    const isRunning = [AsyncTaskStatus.Pending, AsyncTaskStatus.Processing].includes(
      swr.data.status,
    );
    if (!isRunning) return;

    const timer = setInterval(() => {
      swr.mutate();
    }, 5000);

    return () => clearInterval(timer);
  }, [swr.data?.id, swr.data?.status, swr.mutate]);

  return {
    ...swr,
    refresh: swr.mutate,
  };
};
