'use client';

import { memo } from 'react';
import { useParams } from 'react-router-dom';

import { TaskDetailPage } from '@/features/AgentTasks';
import { useTaskStore } from '@/store/task';

const TaskDetailRoute = memo(() => {
  const { taskId } = useParams<{ taskId?: string }>();

  const agentId = useTaskStore((s) =>
    taskId ? (s.taskDetailMap[taskId]?.agentId ?? undefined) : undefined,
  );

  if (!taskId) return null;

  return <TaskDetailPage agentId={agentId} taskId={taskId} />;
});

export default TaskDetailRoute;
