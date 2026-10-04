'use client';

import { useParams } from 'react-router';

import DashboardBoardPage from '@/features/Dashboard/BoardPage';

const DashboardDetailRoute = () => {
  const { dashboardId } = useParams<{ dashboardId: string }>();
  if (!dashboardId) return null;

  return <DashboardBoardPage dashboardId={dashboardId} key={dashboardId} />;
};

export default DashboardDetailRoute;
