'use client';

import { memo } from 'react';
import { useParams } from 'react-router';

import { AgentTasksPage } from '@/features/AgentTasks';

const AgentScopedTasksRoute = memo(() => {
  const { aid } = useParams<{ aid?: string }>();

  if (!aid) return null;

  return <AgentTasksPage agentId={aid} />;
});

export default AgentScopedTasksRoute;
