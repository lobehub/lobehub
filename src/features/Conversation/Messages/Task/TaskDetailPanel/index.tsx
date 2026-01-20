'use client';

import { memo } from 'react';

import { type TaskDetail } from '@/types/index';

import StatusContent from './StatusContent';

interface TaskDetailPanelProps {
  content?: string;
  instruction?: string;
  /**
   * Message ID for updating task status in store
   */
  messageId: string;
  taskDetail?: TaskDetail;
}

const TaskDetailPanel = memo<TaskDetailPanelProps>(({ taskDetail, content, messageId }) => {
  return (
    <>
      <StatusContent content={content} messageId={messageId} taskDetail={taskDetail} />
    </>
  );
});

TaskDetailPanel.displayName = 'TaskDetailPanel';

export default TaskDetailPanel;
