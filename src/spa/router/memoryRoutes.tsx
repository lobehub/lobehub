import { BrainCircuit, Scale } from 'lucide-react';
import type { RouteObject } from 'react-router';

import MemorySkeleton from '@/components/Skeleton/Memory';
import { activityListLoader } from '@/spa/router/activityListLoader';
import { memoryRulesLoader } from '@/spa/router/expertiseLoaders';
import { identitiesListLoader } from '@/spa/router/identitiesListLoader';
import { LegacyMemoryRedirect } from '@/spa/router/legacyPathRedirect';
import { preferenceListLoader } from '@/spa/router/preferenceListLoader';
import { routeMeta } from '@/spa/router/routeMeta';
import { dynamicElement } from '@/utils/router';

/**
 * Memory sections. Desktop mounts them under `/settings/memory`
 * ({@link settingsMemoryChildren}); mobile keeps them at `/memory`
 * (`mobileWorkspaceRoutes.tsx`), where they open full screen.
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
    loader: memoryRulesLoader,
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

/** The memory home's segment under Settings, whose bare URL is the memory settings form. */
const MEMORY_OVERVIEW_SEGMENT = 'overview';

const settingsMemorySegment = (route: RouteObject) =>
  route.index ? MEMORY_OVERVIEW_SEGMENT : route.path!;

const settingsMemoryPath = (route: RouteObject) =>
  `/settings/memory/${settingsMemorySegment(route)}`;

/** The sections as desktop mounts them, under `/settings/memory/<section>`. */
export const settingsMemoryChildren: RouteObject[] = memoryChildren.map((route) =>
  route.index
    ? { element: route.element, handle: route.handle, path: MEMORY_OVERVIEW_SEGMENT }
    : route,
);

/** Desktop `/memory/*`: old links and bookmarks forward to the Settings sections. */
export const legacyMemoryRedirects: RouteObject[] = memoryChildren.map((route) => {
  const element = <LegacyMemoryRedirect to={settingsMemoryPath(route)} />;
  return route.index
    ? { element, handle: route.handle, index: true }
    : { element, handle: route.handle, path: route.path };
});

/** Mobile `/settings/memory/<section>`: a shared link opens the mobile page. */
export const mobileSettingsMemoryRedirects: RouteObject[] = memoryChildren.map((route) => ({
  element: <LegacyMemoryRedirect to={route.index ? '/memory' : `/memory/${route.path}`} />,
  handle: route.handle,
  path: `memory/${settingsMemorySegment(route)}`,
}));
