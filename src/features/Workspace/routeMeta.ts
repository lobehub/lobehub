'use client';

import { useWorkspaces } from '@/business/client/hooks/useWorkspaces';
import { usePublishDynamicRouteMeta } from '@/features/RouteMeta/usePublishDynamicRouteMeta';
import type { DynamicRouteMetaProps } from '@/spa/router/routeMeta';
import { NoRouteSkeleton, routeMeta } from '@/spa/router/routeMeta';

const WorkspaceHomeDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
  const workspaces = useWorkspaces();
  const workspace = workspaces.find((item) => item.slug === params.workspaceSlug);

  usePublishDynamicRouteMeta(
    workspace
      ? {
          avatar: workspace.avatar || workspace.name,
          title: workspace.name,
        }
      : {},
    onResolve,
  );

  return null;
};

export const workspaceHomeRouteMeta = routeMeta({
  DynamicMeta: WorkspaceHomeDynamicMeta,
  // Home is mounted by the layout on web and as a static per-tab element on
  // Electron — either way it never loads inside this outlet, so an outlet
  // skeleton only ever stacks a second home on top of the real one.
  Skeleton: NoRouteSkeleton,
  titleKey: 'navigation.home',
});
