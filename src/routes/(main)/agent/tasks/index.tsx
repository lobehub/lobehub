'use client';

import { useParams } from 'react-router';

import { AgentTasksPage } from '@/features/AgentTasks';

const AgentScopedTasksRoute = () => {
  const { aid } = useParams<{ aid?: string }>();

  if (!aid) return null;

  return <AgentTasksPage agentId={aid} />;
};

export default AgentScopedTasksRoute;
