'use client';

import { memo } from 'react';

import { type TaskDetail, ThreadStatus } from '@/types/index';

import {
  CompletedState,
  ErrorState,
  InitializingState,
  ProcessingState,
  isProcessingStatus,
} from '../../Tasks/shared';

interface StatusContentProps {
  content?: string;
  messageId: string;
  taskDetail?: TaskDetail;
}

const StatusContent = memo<StatusContentProps>(({ taskDetail, content, messageId }) => {
  const status = taskDetail?.status;

  // Initializing state: no status yet (task just created, waiting for backend)
  if (!status) {
    return <InitializingState />;
  }

  // Processing states: Processing, InReview, Pending, Active, Todo
  if (isProcessingStatus(status)) {
    return <ProcessingState messageId={messageId} taskDetail={taskDetail!} variant="detail" />;
  }

  // Completed state
  if (status === ThreadStatus.Completed) {
    return <CompletedState content={content} taskDetail={taskDetail!} variant="detail" />;
  }

  // Error states: Failed, Cancel
  if (status === ThreadStatus.Failed || status === ThreadStatus.Cancel) {
    return <ErrorState taskDetail={taskDetail!} />;
  }

  // Fallback to initializing state for unknown status
  return <InitializingState />;
});

StatusContent.displayName = 'StatusContent';

export default StatusContent;
