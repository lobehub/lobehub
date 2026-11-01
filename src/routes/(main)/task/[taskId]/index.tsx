'use client';

import { useParams } from 'react-router';

import { RoutedTaskDetailPage } from '@/features/AgentTasks';

const TaskDetailRoute = () => {
  const { taskId } = useParams<{ taskId?: string }>();

  if (!taskId) return null;

  return <RoutedTaskDetailPage taskId={taskId} />;
};

export default TaskDetailRoute;
