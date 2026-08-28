'use client';

import { useParams } from 'react-router';

import { TaskDetailPage } from '@/features/AgentTasks';

const TaskDetailRoute = () => {
  const { taskId } = useParams<{ taskId?: string }>();

  if (!taskId) return null;

  return <TaskDetailPage taskId={taskId} />;
};

export default TaskDetailRoute;
