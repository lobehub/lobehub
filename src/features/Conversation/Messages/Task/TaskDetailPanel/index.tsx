'use client';

import { memo } from 'react';

import { type TaskDetail } from '@/types/index';

import ClientTaskDetail from '../ClientTaskDetail';
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
  // Use ClientTaskDetail for client-mode tasks (desktop local execution)
  if (taskDetail?.clientMode) {
    return <ClientTaskDetail content={content} messageId={messageId} taskDetail={taskDetail} />;
  }

  // Default: server-side task execution
  return <StatusContent content={content} messageId={messageId} taskDetail={taskDetail} />;
});

TaskDetailPanel.displayName = 'TaskDetailPanel';

export default TaskDetailPanel;
