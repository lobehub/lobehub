'use client';

import { memo } from 'react';
import { useParams } from 'react-router-dom';

import { TaskDetailPage } from '@/features/AgentTasks';

const TaskDetailRoute = memo(() => {
  const { taskId } = useParams<{ taskId?: string }>();

  if (!taskId) return null;

  return <TaskDetailPage taskId={taskId} />;
});

export default TaskDetailRoute;
