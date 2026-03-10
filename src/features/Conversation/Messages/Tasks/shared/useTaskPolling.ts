'use client';

import { type ThreadStatus } from '@lobechat/types';
import { useEffect, useState } from 'react';

import { useChatStore } from '@/store/chat';

import { isProcessingStatus } from './utils';

interface UseTaskPollingParams {
  messageId: string;
  status: ThreadStatus | undefined;
  threadId: string | undefined;
}

export const useTaskPolling = ({ messageId, threadId, status }: UseTaskPollingParams) => {
  const isProcessing = isProcessingStatus(status);
  const [hasFetched, setHasFetched] = useState(false);

  const [useEnablePollingTaskStatus, operations] = useChatStore((s) => [
    s.useEnablePollingTaskStatus,
    s.operations,
  ]);

  // Check if exec_async_task is already polling for this message
  const hasActiveOperationPolling = Object.values(operations).some(
    (op) =>
      op.status === 'running' &&
      op.type === 'execAgentRuntime' &&
      op.context?.messageId === messageId,
  );

  // Enable polling when:
  // 1. Has threadId
  // 2. Not already being polled by an active operation
  // 3. Either hasn't fetched yet (initial fetch) or is still processing (continuous polling)
  const shouldPoll = !!threadId && !hasActiveOperationPolling && (!hasFetched || isProcessing);
  const { data } = useEnablePollingTaskStatus(threadId, messageId, shouldPoll);

  // Mark as fetched when we get data
  useEffect(() => {
    if (data?.taskDetail && !hasFetched) {
      setHasFetched(true);
    }
  }, [data?.taskDetail, hasFetched]);

  return { isProcessing };
};
