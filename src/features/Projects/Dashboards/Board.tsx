'use client';

import { useParams } from 'react-router';

import DashboardBoardPage from '@/features/Dashboard/BoardPage';

import { getProjectDashboardPath } from '../Layout/navigation';

/** `project/:projectId/dashboard/:dashboardId` — one project board, back to the project's list. */
const ProjectDashboardBoard = () => {
  const { dashboardId, projectId } = useParams<{ dashboardId: string; projectId: string }>();
  if (!dashboardId || !projectId) return null;

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
