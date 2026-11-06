import { LayoutDashboardIcon } from 'lucide-react';
import { lazy } from 'react';

import { createSurfaceSkeleton } from '@/components/Skeleton/Surface';
import { routeMeta } from '@/spa/router/routeMeta';

// Route metas load with the router on first paint; keep the Dashboard store out of that graph.
const DashboardDynamicMeta = lazy(() => import('./DashboardDynamicMeta'));

export const dashboardsRouteMeta = routeMeta({
  icon: LayoutDashboardIcon,
  Skeleton: createSurfaceSkeleton('grid'),
  titleKey: 'navigation.dashboard',
});

export const dashboardRouteMeta = routeMeta({
  DynamicMeta: DashboardDynamicMeta,
  icon: LayoutDashboardIcon,
  Skeleton: createSurfaceSkeleton('grid'),
  titleKey: 'navigation.dashboard',
});
