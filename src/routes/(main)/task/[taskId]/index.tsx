'use client';

import { TaskDetailPage } from '@/features/AgentTasks';
import { useParams } from '@/libs/router/navigation';

const TaskDetailRoute = () => {
  const { taskId } = useParams<{ taskId?: string }>('taskId');

  if (!taskId) return null;

  return <TaskDetailPage taskId={taskId} />;
};

export default TaskDetailRoute;
