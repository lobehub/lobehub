import { FileUserIcon, Users, UsersIcon } from 'lucide-react';
import { lazy } from 'react';

import ConversationLayoutSkeleton from '@/components/Skeleton/Conversation/Layout';
import { GroupProfileRouteSkeleton } from '@/components/Skeleton/Profile';
import { createSurfaceSkeleton } from '@/components/Skeleton/Surface';
import { routeMeta } from '@/spa/router/routeMeta';

const GroupDynamicMeta = lazy(() => import('@/features/RouteMeta/GroupDynamicMeta'));
const GroupProfileDynamicMeta = lazy(() =>
  import('@/features/RouteMeta/GroupDynamicMeta').then((module) => ({
    default: module.GroupProfileDynamicMeta,
  })),
);
const GroupPermissionDynamicMeta = lazy(() =>
  import('@/features/RouteMeta/GroupDynamicMeta').then((module) => ({
    default: module.GroupPermissionDynamicMeta,
  })),
);

export const groupRouteMeta = routeMeta({
  DynamicMeta: GroupDynamicMeta,
  icon: Users,
  Skeleton: ConversationLayoutSkeleton,
  titleKey: 'navigation.groupChat',
});

export const groupProfileRouteMeta = routeMeta({
  DynamicMeta: GroupProfileDynamicMeta,
  icon: FileUserIcon,
  Skeleton: GroupProfileRouteSkeleton,
  titleKey: 'navigation.groupProfile',
});

export const groupPermissionRouteMeta = routeMeta({
  DynamicMeta: GroupPermissionDynamicMeta,
  icon: UsersIcon,
  Skeleton: createSurfaceSkeleton('form'),
  titleKey: 'navigation.permission',
});
