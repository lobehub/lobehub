'use client';

import { AgentTasksPage } from '@/features/AgentTasks';
import { useParams } from '@/libs/router/navigation';
import { useCurrentProjectDetail } from '@/store/project';

const ProjectTasks = () => {
  const { projectId } = useParams<{ projectId: string }>('projectId');
  const detail = useCurrentProjectDetail(projectId);

  if (!detail) return null;

  return <AgentTasksPage projectId={detail.project.id} />;
};

export default ProjectTasks;
