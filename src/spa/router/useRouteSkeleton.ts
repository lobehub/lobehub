import { useEffect, useMemo } from 'react';
import { useMatches } from 'react-router';

import { getRouteMetaFromHandle, type RouteSkeleton } from './routeMeta';

export const resolveRouteSkeleton = (
  matches: Array<{ handle?: unknown }>,
): RouteSkeleton | undefined => {
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

// A skeleton kept out of the entry graph would otherwise start loading only when
// the first fallback renders, leaving that fallback blank until its chunk lands.
export const usePreloadRouteSkeleton = () => {
  const Skeleton = useRouteSkeleton();

  useEffect(() => {
    Skeleton?.preload?.().catch(() => {});
  }, [Skeleton]);
};

export const RouteSkeletonPreloader = () => {
  usePreloadRouteSkeleton();
  return null;
};
