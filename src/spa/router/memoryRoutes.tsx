import { BrainCircuit, Scale } from 'lucide-react';
import type { RouteObject } from 'react-router';

import MemorySkeleton from '@/components/Skeleton/Memory';
import { activityListLoader } from '@/spa/router/activityListLoader';
import { identitiesListLoader } from '@/spa/router/identitiesListLoader';
import { preferenceListLoader } from '@/spa/router/preferenceListLoader';
import { routeMeta } from '@/spa/router/routeMeta';
import { dynamicElement } from '@/utils/router';

/**
 * `/memory` sections. Mounted by the desktop router under the memory layout
 * and reused by the mobile router (`mobileWorkspaceRoutes.tsx`).
 */
export const memoryChildren: RouteObject[] = [
  {
    element: dynamicElement(
      () => import('@/routes/(main)/memory/(home)'),
      'Desktop > Memory > Home',
      { preloadId: 'memory' },
    ),
    handle: {
      meta: routeMeta({
        icon: BrainCircuit,
        Skeleton: MemorySkeleton,
        titleKey: 'navigation.memory',
      }),
    },
    index: true,
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/memory/identities'),
      'Desktop > Memory > Identities',
    ),
    handle: {
      meta: routeMeta({ icon: BrainCircuit, titleKey: 'navigation.memoryIdentities' }),
    },
    // Seed the persisted identity list before the page paints, so a cold
    // start shows the local copy instead of a loading state.
    loader: identitiesListLoader,
    path: 'identities',
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/memory/contexts'),
      'Desktop > Memory > Contexts',
    ),
    handle: {
      meta: routeMeta({ icon: BrainCircuit, titleKey: 'navigation.memoryContexts' }),
    },
    path: 'contexts',
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/memory/preferences'),
      'Desktop > Memory > Preferences',
    ),
    handle: {
      meta: routeMeta({ icon: BrainCircuit, titleKey: 'navigation.memoryPreferences' }),
    },
    loader: preferenceListLoader,
    path: 'preferences',
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/memory/rules'),
      'Desktop > Memory > Rules',
    ),
    handle: {
      // Same icon the memory sidebar uses, so a desktop tab and the nav item agree.
      meta: routeMeta({ icon: Scale, titleKey: 'navigation.memoryRules' }),
    },
    path: 'rules',
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/memory/activities'),
      'Desktop > Memory > Activities',
    ),
    handle: {
      meta: routeMeta({ icon: BrainCircuit, titleKey: 'navigation.memory' }),
    },
    // Seed the persisted head page before the page paints (see `activityListLoader`).
    loader: activityListLoader,
    path: 'activities',
  },
];
