'use client';

import { memo } from 'react';
import { useParams } from 'react-router';

import { AgentScopedTaskDetailPage } from '@/features/AgentTasks';

const AgentTaskDetailRoute = memo(() => {
  const { aid, taskId } = useParams<{ aid?: string; taskId?: string }>();

  if (!taskId) return null;

  return <AgentScopedTaskDetailPage agentId={aid} taskId={taskId} />;
});

export default AgentTaskDetailRoute;
