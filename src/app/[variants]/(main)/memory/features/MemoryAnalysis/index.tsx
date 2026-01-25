'use client';

import { AsyncTaskStatus } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { memo, useMemo } from 'react';

import AnalysisAction from './Action';
import { MemoryAnalysisStatus } from './Status';
import { useMemoryAnalysisAsyncTask } from './useTask';

const MemoryAnalysis = memo(() => {
  const { data, isValidating } = useMemoryAnalysisAsyncTask();

  const { showAction, showStatus } = useMemo(() => {
    const status = data?.status;
    const isRunning = status === AsyncTaskStatus.Pending || status === AsyncTaskStatus.Processing;
    const isError = status === AsyncTaskStatus.Error;

    console.log(isRunning, isValidating, isError, data);

    return {
      showAction: (!isRunning && (!isValidating || isError)) || !data || isError,
      showStatus: Boolean(data && (isRunning || isError)),
    };
  }, [data, isValidating]);

  if (!showAction && !showStatus) return null;

  return (
    <Flexbox gap={12} style={{ paddingTop: 16, width: '100%' }}>
      {showStatus && <MemoryAnalysisStatus task={data} />}
      {showAction && <AnalysisAction />}
    </Flexbox>
  );
});

MemoryAnalysis.displayName = 'MemoryAnalysis';

export default MemoryAnalysis;
