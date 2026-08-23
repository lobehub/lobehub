'use client';

import { AgentGoalsPage } from '@/features/AgentGoals';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';
import { useCurrentProjectDetail } from '@/store/project';

const ProjectGoals = () => {
  const { projectId } = useActiveRouteParams<{ projectId: string }>();
  const detail = useCurrentProjectDetail(projectId);

  if (!detail) return null;

  return <AgentGoalsPage projectId={detail.project.id} />;
};

export default ProjectGoals;
