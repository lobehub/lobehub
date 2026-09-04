'use client';

import { useWorkspaces } from '@/business/client/hooks/useWorkspaces';
import HomeSkeleton from '@/components/Skeleton/Home';
import { isDesktop } from '@/const/version';
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

const NoSkeleton = () => null;

export const workspaceHomeRouteMeta = routeMeta({
  DynamicMeta: WorkspaceHomeDynamicMeta,
  // Web mounts Home beside the router outlet (see `(main)/_layout`) and shows
  // it whenever the path is the active workspace root, so an outlet skeleton
  // stacks a second home on top of the real one. Electron mounts Home inside
  // the outlet per tab and does need the skeleton.
  Skeleton: isDesktop ? HomeSkeleton : NoSkeleton,
  titleKey: 'navigation.home',
});
