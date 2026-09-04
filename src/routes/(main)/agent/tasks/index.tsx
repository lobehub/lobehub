'use client';

import { AgentTasksPage } from '@/features/AgentTasks';
import { useParams } from '@/libs/router/navigation';

const AgentScopedTasksRoute = () => {
  const { aid } = useParams<{ aid?: string }>('aid');

  if (!aid) return null;

  return <AgentTasksPage agentId={aid} />;
};

export default AgentScopedTasksRoute;
