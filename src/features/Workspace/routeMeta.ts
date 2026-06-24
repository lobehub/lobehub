'use client';

import { useWorkspaces } from '@/business/client/hooks/useWorkspaces';
import { usePublishDynamicRouteMeta } from '@/features/RouteMeta/usePublishDynamicRouteMeta';
import type { DynamicRouteMetaProps } from '@/spa/router/routeMeta';
import { routeMeta } from '@/spa/router/routeMeta';

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
  titleKey: 'navigation.home',
});
