'use client';

import { AgentTasksPage } from '@/features/AgentTasks';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';

const ProjectTasks = () => {
  const { projectId } = useActiveRouteParams<{ projectId: string }>();

  return <AgentTasksPage projectId={projectId} />;
};

export default ProjectTasks;
