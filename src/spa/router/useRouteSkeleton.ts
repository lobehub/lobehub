import type { ComponentType } from 'react';
import { useMemo } from 'react';
import { useMatches } from 'react-router';

import { getRouteMetaFromHandle, type RouteSkeletonProps } from './routeMeta';

export const resolveRouteSkeleton = (
  matches: Array<{ handle?: unknown }>,
): ComponentType<RouteSkeletonProps> | undefined => {
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const Skeleton = getRouteMetaFromHandle(matches[i].handle)?.Skeleton;
    if (Skeleton) return Skeleton;
  }

  return undefined;
};

export const useRouteSkeleton = () => {
  const matches = useMatches();

  return useMemo(() => resolveRouteSkeleton(matches), [matches]);
};
