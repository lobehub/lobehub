import { FileUserIcon, Users } from 'lucide-react';
import { lazy } from 'react';

import { routeMeta } from '@/spa/router/routeMeta';

const GroupDynamicMeta = lazy(() => import('@/features/RouteMeta/GroupDynamicMeta'));
const GroupProfileDynamicMeta = lazy(() =>
  import('@/features/RouteMeta/GroupDynamicMeta').then((module) => ({
    default: module.GroupProfileDynamicMeta,
  })),
);

export const groupRouteMeta = routeMeta({
  DynamicMeta: GroupDynamicMeta,
  icon: Users,
  titleKey: 'navigation.groupChat',
});

export const groupProfileRouteMeta = routeMeta({
  DynamicMeta: GroupProfileDynamicMeta,
  icon: FileUserIcon,
  titleKey: 'navigation.groupProfile',
});
