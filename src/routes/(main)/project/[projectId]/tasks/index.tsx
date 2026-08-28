'use client';

import { AgentTasksPage } from '@/features/AgentTasks';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';
import { useCurrentProjectDetail } from '@/store/project';

const ProjectTasks = () => {
  const { projectId } = useActiveRouteParams<{ projectId: string }>();
  const detail = useCurrentProjectDetail(projectId);

  if (!detail) return null;

  return <AgentTasksPage projectId={detail.project.id} />;
};

export default ProjectTasks;
