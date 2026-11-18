import { ClipboardCheckIcon, FolderClosedIcon } from 'lucide-react';
import { lazy } from 'react';

import ConversationSegmentSkeleton from '@/components/Skeleton/Conversation/Segment';
import { createSurfaceSkeleton } from '@/components/Skeleton/Surface';
import { goalsRouteMeta } from '@/features/AgentGoals/routeMeta';
import { tasksRouteMeta } from '@/features/AgentTasks/routeMeta';
import { dashboardsRouteMeta } from '@/features/Dashboard/routeMeta';
import { routeMeta } from '@/spa/router/routeMeta';

// Route metas load with the router on first paint; the runner reads the chat
// and project stores, so keep it out of the entry graph.
const ProjectConversationDynamicMeta = lazy(
  () => import('@/features/RouteMeta/ProjectDynamicMeta'),
);
const ProjectSectionDynamicMeta = lazy(() =>
  import('@/features/RouteMeta/ProjectDynamicMeta').then((module) => ({
    default: module.ProjectSectionDynamicMeta,
  })),
);

export const projectsRouteMeta = routeMeta({
  icon: FolderClosedIcon,
  Skeleton: createSurfaceSkeleton('grid'),
  titleKey: 'navigation.projects',
});

export const projectDirectoriesRouteMeta = routeMeta({
  DynamicMeta: ProjectSectionDynamicMeta,
  icon: FolderClosedIcon,
  Skeleton: createSurfaceSkeleton('list'),
  titleKey: 'project:settings.title',
});

export const projectHomeRouteMeta = routeMeta({
  DynamicMeta: ProjectSectionDynamicMeta,
  icon: FolderClosedIcon,
  Skeleton: createSurfaceSkeleton('detail'),
  titleKey: 'project:sections.home',
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
  DynamicMeta: ProjectSectionDynamicMeta,
  icon: ClipboardCheckIcon,
  Skeleton: createSurfaceSkeleton('detail'),
  titleKey: 'project:sections.acceptance',
});

// Shared list metas mounted inside a project take on the project's avatar like its other
// sections, so two projects' Goals / Tasks / Dashboards are told apart in tabs and history.
export const projectGoalsRouteMeta = routeMeta({
  ...goalsRouteMeta,
  DynamicMeta: ProjectSectionDynamicMeta,
});

export const projectTasksRouteMeta = routeMeta({
  ...tasksRouteMeta,
  DynamicMeta: ProjectSectionDynamicMeta,
});

export const projectDashboardsRouteMeta = routeMeta({
  ...dashboardsRouteMeta,
  DynamicMeta: ProjectSectionDynamicMeta,
});
