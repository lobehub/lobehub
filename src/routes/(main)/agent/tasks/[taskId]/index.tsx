'use client';

import { memo } from 'react';
import { useParams } from 'react-router-dom';

import { TaskDetailPage } from '@/features/AgentTasks';

const TaskDetailRoute = memo(() => {
  const { aid, taskId } = useParams<{ aid?: string; taskId?: string }>();

  if (!aid || !taskId) return null;

  return <TaskDetailPage agentId={aid} taskId={taskId} />;
});

export default TaskDetailRoute;
