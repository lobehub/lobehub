'use client';

import AsyncError from '@/components/AsyncError';
import { RouteLoading } from '@/components/Skeleton/RouteSegment';
import { AgentTasksPage } from '@/features/AgentTasks';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';
import { useProjectStore } from '@/store/project';

const ProjectTasks = () => {
  const { projectId } = useActiveRouteParams<{ projectId: string }>();
  const { data, error, isLoading, mutate } = useProjectStore((s) => s.useFetchProjectDetail)(
    projectId,
  );

  if (isLoading && !data) return <RouteLoading />;
  if (error && !data)
    return <AsyncError error={error} variant={'page'} onRetry={() => void mutate()} />;
  if (!data) return null;

  return <AgentTasksPage projectId={data.data.project.id} />;
};

export default ProjectTasks;
