'use client';

import { Outlet } from 'react-router';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import AsyncError from '@/components/AsyncError';
import { RouteLoading } from '@/components/Skeleton/RouteSegment';
import { AcceptanceRouteBaseContext } from '@/features/Acceptance';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';
import { useCurrentProjectDetail, useProjectStore } from '@/store/project';

import { getProjectAcceptancePath } from '../Layout/navigation';

/**
 * `project/:projectId/acceptance` layout: the project's full-width list at the
 * index, one acceptance below it. Every acceptance link rendered inside points
 * back into this section rather than at the standalone `/acceptance` pages.
 */
const ProjectAcceptanceLayout = () => {
  const { projectId } = useActiveRouteParams<{ projectId: string }>();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  // The persisted project paints on the first frame; the hook only syncs it.
  const detail = useCurrentProjectDetail(projectId);
  const { error, isHydrated, isValidating, revalidate } = useProjectStore(
    (s) => s.useFetchProjectDetail,
  )(projectId);

  if (!detail && (!isHydrated || isValidating)) return <RouteLoading />;
  if (error && !detail)
    return <AsyncError error={error} variant={'page'} onRetry={() => void revalidate()} />;
  if (!detail || !projectId) return null;

  return (
    <AcceptanceRouteBaseContext
      value={buildWorkspaceAwarePath(getProjectAcceptancePath(projectId), activeWorkspaceSlug)}
    >
      <Outlet />
    </AcceptanceRouteBaseContext>
  );
};

export default ProjectAcceptanceLayout;
