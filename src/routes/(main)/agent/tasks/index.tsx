'use client';

import { memo } from 'react';
import { useParams } from 'react-router-dom';

import { AgentTasksPage } from '@/features/AgentTasks';

const TasksRoute = memo(() => {
  const { aid } = useParams<{ aid?: string }>();

  if (!aid) return null;

  return <AgentTasksPage agentId={aid} />;
});

export default TasksRoute;
