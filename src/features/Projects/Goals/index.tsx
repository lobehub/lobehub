'use client';

import { AgentGoalsPage } from '@/features/AgentGoals';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';

const ProjectGoals = () => {
  const { projectId } = useActiveRouteParams<{ projectId: string }>();

  return <AgentGoalsPage projectId={projectId} />;
};

export default ProjectGoals;
