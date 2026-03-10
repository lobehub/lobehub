'use client';

import { memo } from 'react';

import { useChatStore } from '@/store/chat';
import { type TaskDetail } from '@/types/index';
import { ThreadStatus } from '@/types/index';

import {
  ErrorState,
  InitializingState,
  isProcessingStatus,
  TaskMessages,
} from '../../Tasks/shared';

interface StatusContentProps {
  content?: string;
  messageId: string;
  taskDetail?: TaskDetail;
}

const StatusContent = memo<StatusContentProps>(({ taskDetail, messageId }) => {
  const status = taskDetail?.status;
  const threadId = taskDetail?.threadId;
  const isProcessing = isProcessingStatus(status);

  // Get polling hook - poll for task status to get messages
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

  // Enable polling when task has threadId and no active operation is polling
  // For completed tasks, this will fetch messages once (no refreshInterval needed)
  const shouldPoll = !!threadId && !hasActiveOperationPolling;
  const { data } = useEnablePollingTaskStatus(threadId, messageId, shouldPoll);

  const messages = data?.messages;

  // Initializing state: no status yet (task just created, waiting for backend)
  if (!status) {
    return <InitializingState />;
  }

  // Processing or Completed state with messages
  if (messages && messages.length > 0) {
    return (
      <>
        <TaskMessages
          duration={taskDetail?.duration}
          isProcessing={isProcessing}
          messages={messages}
          startTime={taskDetail?.startedAt ? new Date(taskDetail.startedAt).getTime() : undefined}
          totalCost={taskDetail?.totalCost}
        />
        {
          // Error states: Failed, Cancel
          (status === ThreadStatus.Failed || status === ThreadStatus.Cancel) && (
            <ErrorState taskDetail={taskDetail!} />
          )
        }
      </>
    );
  }

  // Still loading messages
  return <InitializingState />;
});

StatusContent.displayName = 'StatusContent';

export default StatusContent;
