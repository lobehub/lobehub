'use client';

import { memo } from 'react';

import { AgentScopedTaskDetailPage } from '@/features/AgentTasks';
import { useParams } from '@/libs/router/navigation';

const AgentTaskDetailRoute = memo(() => {
  const { aid, taskId } = useParams<{ aid?: string; taskId?: string }>('aid', 'taskId');

  if (!taskId) return null;

  return <AgentScopedTaskDetailPage agentId={aid} taskId={taskId} />;
});

export default AgentTaskDetailRoute;
