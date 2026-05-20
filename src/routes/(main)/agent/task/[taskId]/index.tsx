'use client';

import { memo } from 'react';
import { useParams } from 'react-router-dom';

import { TaskDetailPage } from '@/features/AgentTasks';

const AgentTaskDetailRoute = memo(() => {
  const { taskId } = useParams<{ taskId?: string }>();

  if (!taskId) return null;

  return <TaskDetailPage showTaskAgentPanelToggle={false} taskId={taskId} />;
});

export default AgentTaskDetailRoute;
