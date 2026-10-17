// @vitest-environment happy-dom
import type { RouteObject } from 'react-router';
import { describe, expect, it } from 'vitest';

import {
  AgentChannelDetailSkeleton,
  AgentChannelSkeleton,
} from '@/components/Skeleton/AgentChannel';
import AgentStatisticsSkeleton from '@/components/Skeleton/AgentStatistics';
import AgentViewAllSkeleton from '@/components/Skeleton/AgentViewAll';

import { desktopRoutes } from './desktopRouter.config';
import { getRouteMetaFromHandle } from './routeMeta';

const flatten = (routes: RouteObject[]): RouteObject[] =>
  routes.flatMap((route) => [route, ...(route.children ? flatten(route.children) : [])]);

const skeletonsOf = (path: string) =>
  new Set(
    flatten(desktopRoutes)
      .filter((route) => route.path === path)
      // A path-only parent (e.g. `agents`) carries its meta on the index child.
      .map((route) => route.children?.find((child) => child.index) ?? route)
      .map((route) => getRouteMetaFromHandle(route.handle)?.Skeleton),
  );

describe('agent page route skeletons', () => {
  it('draws the channel card grid for the channel list', () => {
    expect(skeletonsOf('channel')).toEqual(new Set([AgentChannelSkeleton]));
  });

  // The detail used to inherit the list's meta and flash a card grid before a form.
  it('draws the credential form for a channel platform detail', () => {
    expect(skeletonsOf('channel/:platform')).toEqual(new Set([AgentChannelDetailSkeleton]));
  });

  // Workspace settings also has a `statistics` child, so only assert membership.
  it('draws the usage dashboard for agent statistics', () => {
    expect(skeletonsOf('statistics').has(AgentStatisticsSkeleton)).toBe(true);
  });

  it('draws the agent list rows for the view-all page', () => {
    expect(skeletonsOf('agents')).toEqual(new Set([AgentViewAllSkeleton]));
  });
});
