'use client';

import { AgentGoalsPage } from '@/features/AgentGoals';
import { useParams } from '@/libs/router/navigation';
import { useCurrentProjectDetail } from '@/store/project';

const ProjectGoals = () => {
  const { projectId } = useParams<{ projectId: string }>('projectId');
  const detail = useCurrentProjectDetail(projectId);

  if (!detail) return null;

  return <AgentGoalsPage projectId={detail.project.id} />;
};

export default ProjectGoals;
