'use client';

import { Navigate, useParams } from 'react-router';

import DashboardBoardPage from '@/features/Dashboard/BoardPage';
import { dashboardSelectors, useDashboardStore } from '@/store/dashboard';

import { getProjectDashboardPath } from '../Layout/navigation';

/** `project/:projectId/dashboard/:dashboardId` — one project board, back to the project's list. */
const ProjectDashboardBoard = () => {
  const { dashboardId, projectId } = useParams<{ dashboardId: string; projectId: string }>();
  // A home board or another project's board is not this project's: leave for the list.
  const outsideProject = useDashboardStore(
    dashboardSelectors.isDashboardOutsideProject(dashboardId ?? '', projectId ?? ''),
  );
  if (!dashboardId || !projectId) return null;
  if (outsideProject) return <Navigate replace to={'..'} />;

  return (
    <DashboardBoardPage
      backPath={getProjectDashboardPath(projectId)}
      dashboardId={dashboardId}
      key={dashboardId}
      level={{ projectId }}
    />
  );
};

export default ProjectDashboardBoard;
