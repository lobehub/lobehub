import { FolderClosedIcon } from 'lucide-react';

import ConversationSegmentSkeleton from '@/components/Skeleton/Conversation/Segment';
import { createSurfaceSkeleton } from '@/components/Skeleton/Surface';
import { routeMeta } from '@/spa/router/routeMeta';

export const projectsRouteMeta = routeMeta({
  icon: FolderClosedIcon,
  Skeleton: createSurfaceSkeleton('grid'),
  titleKey: 'navigation.projects',
});

export const projectDirectoriesRouteMeta = routeMeta({
  icon: FolderClosedIcon,
  Skeleton: createSurfaceSkeleton('list'),
  titleKey: 'project:settings.title',
});

export const projectConversationRouteMeta = routeMeta({
  icon: FolderClosedIcon,
  Skeleton: ConversationSegmentSkeleton,
  titleKey: 'project:topics.title',
});
