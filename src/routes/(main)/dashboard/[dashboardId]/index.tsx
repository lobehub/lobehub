'use client';

import { Navigate, useParams } from 'react-router';

import DashboardBoardPage from '@/features/Dashboard/BoardPage';
import { getHomeDashboardRedirect } from '@/features/Dashboard/utils/path';
import { dashboardSelectors, useDashboardStore } from '@/store/dashboard';

const DashboardDetailRoute = () => {
  const { dashboardId } = useParams<{ dashboardId: string }>();
  const detail = useDashboardStore(dashboardSelectors.dashboardDetail(dashboardId));
  // A project's board is not a home board: once it loads, leave for its
  // project path so it renders inside the project shell instead of with the
  // home back path.
  const projectPath = getHomeDashboardRedirect(detail);
  if (!dashboardId) return null;
  if (projectPath) return <Navigate replace to={projectPath} />;

  return <DashboardBoardPage dashboardId={dashboardId} key={dashboardId} />;
};

export default DashboardDetailRoute;
