import { LayoutDashboardIcon } from 'lucide-react';

import { createSurfaceSkeleton } from '@/components/Skeleton/Surface';
import { routeMeta } from '@/spa/router/routeMeta';

export const dashboardsRouteMeta = routeMeta({
  icon: LayoutDashboardIcon,
  Skeleton: createSurfaceSkeleton('grid'),
  titleKey: 'navigation.dashboard',
});

export const dashboardRouteMeta = routeMeta({
  icon: LayoutDashboardIcon,
  Skeleton: createSurfaceSkeleton('grid'),
  titleKey: 'navigation.dashboard',
});
