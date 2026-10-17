import { ClipboardCheckIcon, FolderClosedIcon } from 'lucide-react';
import { lazy } from 'react';

import ConversationSegmentSkeleton from '@/components/Skeleton/Conversation/Segment';
import { createSurfaceSkeleton } from '@/components/Skeleton/Surface';
import { routeMeta } from '@/spa/router/routeMeta';

// Route metas load with the router on first paint; the runner reads the chat
// and project stores, so keep it out of the entry graph.
const ProjectConversationDynamicMeta = lazy(
  () => import('@/features/RouteMeta/ProjectDynamicMeta'),
);

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
  DynamicMeta: ProjectConversationDynamicMeta,
  icon: FolderClosedIcon,
  Skeleton: ConversationSegmentSkeleton,
  titleKey: 'project:topics.title',
});

// The project acceptance section has no `:acceptanceId` param, so it cannot
// reuse `acceptanceRouteMeta` — its DynamicMeta would pin the tab to the
// generic fallback label.
export const projectAcceptanceRouteMeta = routeMeta({
  icon: ClipboardCheckIcon,
  Skeleton: createSurfaceSkeleton('detail'),
  titleKey: 'project:sections.acceptance',
});
