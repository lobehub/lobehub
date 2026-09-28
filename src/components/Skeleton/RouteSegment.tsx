'use client';

import { useLayoutEffect } from 'react';

import { useRouteSkeletonChrome } from '@/spa/router/routeSkeletonChrome';
import { useRouteSkeleton } from '@/spa/router/useRouteSkeleton';

import DelayedFallback from './Delayed';
import { markSkeletonVisible } from './skeletonHandover';

// Same component the route Suspense fallback renders, so a page's data wait
// continues the chunk wait's skeleton instead of swapping to a second one.
export const RouteLoading = () => {
  const Skeleton = useRouteSkeleton();
  const chrome = useRouteSkeletonChrome();

  useLayoutEffect(() => {
    if (!Skeleton) return;
    markSkeletonVisible();
    return markSkeletonVisible;
  }, [Skeleton]);

  if (!Skeleton) return null;
  return <Skeleton chrome={chrome} />;
};

const RouteSegmentSkeleton = () => (
  <DelayedFallback>
    <RouteLoading />
  </DelayedFallback>
);

export default RouteSegmentSkeleton;
