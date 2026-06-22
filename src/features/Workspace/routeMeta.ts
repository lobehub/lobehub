'use client';

import { useWorkspaces } from '@/business/client/hooks/useWorkspaces';
import { type DynamicRouteMeta, routeMeta } from '@/spa/router/routeMeta';

export const workspaceHomeRouteMeta = routeMeta({
  titleKey: 'navigation.home',
  useDynamicMeta: (params): DynamicRouteMeta => {
    const workspaces = useWorkspaces();
    const workspace = workspaces.find((item) => item.slug === params.workspaceSlug);

    if (!workspace) return {};

    return {
      avatar: workspace.avatar || workspace.name,
      title: workspace.name,
    };
  },
});
