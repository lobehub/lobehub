'use client';

import AsyncError from '@/components/AsyncError';
import { RouteLoading } from '@/components/Skeleton/RouteSegment';
import { AcceptanceWorkspace } from '@/features/Acceptance';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';
import { useCurrentProjectDetail, useProjectStore } from '@/store/project';

const ProjectAcceptance = () => {
  const { projectId } = useActiveRouteParams<{ projectId: string }>();
  // The persisted project paints on the first frame; the hook only syncs it.
  const detail = useCurrentProjectDetail(projectId);
  const { error, isHydrated, isValidating, revalidate } = useProjectStore(
    (s) => s.useFetchProjectDetail,
  )(projectId);

  if (!detail && (!isHydrated || isValidating)) return <RouteLoading />;
  if (error && !detail)
    return <AsyncError error={error} variant={'page'} onRetry={() => void revalidate()} />;
  if (!detail) return null;

  return <AcceptanceWorkspace projectId={detail.project.id} />;
};

export default ProjectAcceptance;
