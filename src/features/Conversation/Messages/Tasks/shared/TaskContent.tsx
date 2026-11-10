'use client';

import { type TaskDetail, type ThreadStatus, type UIChatMessage } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import BubblesLoading from '@/components/BubblesLoading';

import ErrorState from './ErrorState';
import InitializingState from './InitializingState';
import TaskMessages from './TaskMessages';
import { useTaskPolling } from './useTaskPolling';

export interface TaskContentProps {
  id: string;
  isError: boolean;
  messages: UIChatMessage[] | undefined;
  status: ThreadStatus | undefined;
  taskDetail: TaskDetail | undefined;
  threadId: string | undefined;
}

const TaskContent = memo<TaskContentProps>(
  ({ id, threadId, status, messages, taskDetail, isError }) => {
    const { t } = useTranslation('chat');
    const { isProcessing } = useTaskPolling({
      messageId: id,
      status,
      threadId,
    });

    // No messages yet
    if (!messages || messages.length === 0) {
      // Still processing: show full initializing state
      if (isProcessing) {
        return <InitializingState />;
      }

      // Already completed but loading messages: show simple loading
      return (
        <Flexbox horizontal align="center" gap={4}>
          <BubblesLoading />
          <Text type="secondary">{t('task.status.fetchingDetails')}</Text>
        </Flexbox>
      );
    }

    return (
      <>
        <TaskMessages
          duration={taskDetail?.duration}
          isProcessing={isProcessing}
          messages={messages}
          startTime={taskDetail?.startedAt ? new Date(taskDetail.startedAt).getTime() : undefined}
          totalCost={taskDetail?.totalCost}
        />
        {/* Error states: Failed, Cancel */}
        {isError && taskDetail && <ErrorState taskDetail={taskDetail} />}
      </>
    );
  },
);

TaskContent.displayName = 'TaskContent';

export default TaskContent;
