import { Users } from 'lucide-react';
import { lazy } from 'react';

import { routeMeta } from '@/spa/router/routeMeta';

const GroupDynamicMeta = lazy(() => import('@/features/RouteMeta/GroupDynamicMeta'));

export const groupRouteMeta = routeMeta({
  DynamicMeta: GroupDynamicMeta,
  icon: Users,
  titleKey: 'navigation.groupChat',
});
