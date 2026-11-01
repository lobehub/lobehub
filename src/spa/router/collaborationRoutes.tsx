import type { RouteObject } from 'react-router';

import { agentsRouteMeta } from '@/features/AgentViewAll/routeMeta';
import { channelRouteMeta } from '@/features/Channels/routeMeta';
import { dashboardRouteMeta, dashboardsRouteMeta } from '@/features/Dashboard/routeMeta';
import { projectsRouteMeta } from '@/features/Projects/routeMeta';
import { dynamicElement, dynamicLayout, ErrorBoundary, redirectElement } from '@/utils/router';

export const collaborationRoutes: RouteObject[] = [
  // Agents view-all route (flat list of workspace/private agents)
  {
    children: [
      {
        element: dynamicElement(() => import('@/routes/(main)/agents'), 'Desktop > Agents', {
          preloadId: 'agents',
        }),
        handle: { meta: agentsRouteMeta },
        index: true,
      },
    ],
    errorElement: <ErrorBoundary resetPath=".." />,
    path: 'agents',
  },

  // Projects view-all route
  {
    children: [
      {
        element: dynamicElement(() => import('@/routes/(main)/projects'), 'Desktop > Projects', {
          preloadId: 'projects',
        }),
        handle: { meta: projectsRouteMeta },
        index: true,
      },
    ],
    errorElement: <ErrorBoundary resetPath=".." />,
    path: 'projects',
  },

  // Personal dashboards (free-form monitoring boards)
  {
    children: [
      {
        element: dynamicElement(() => import('@/routes/(main)/dashboard'), 'Desktop > Dashboards', {
          preloadId: 'dashboard',
        }),
        handle: { meta: dashboardsRouteMeta },
        index: true,
      },
      {
        element: dynamicElement(
          () => import('@/routes/(main)/dashboard/[dashboardId]'),
          'Desktop > Dashboard Detail',
          { preloadId: 'dashboard' },
        ),
        handle: { meta: dashboardRouteMeta },
        path: ':dashboardId',
      },
    ],
    // Personal-only, and off unless the `dashboard` feature flag is on: the gate
    // leaves for home inside a workspace or while the flag is off.
    element: dynamicLayout(
      () => import('@/routes/(main)/dashboard/_layout'),
      'Desktop > Dashboards > Layout',
      {
        preloadId: 'dashboard',
      },
    ),
    errorElement: <ErrorBoundary resetPath=".." />,
    path: 'dashboard',
  },

  // Channels are listed in the home sidebar; a thread opens beside its Channel via `?thread=`.
  {
    children: [
      // No collection page: old `/channels` links return home, where the list lives.
      { element: redirectElement('..'), index: true },
      {
        element: dynamicElement(
          () => import('@/routes/(main)/channels/[channelId]'),
          'Desktop > Channel',
          { preloadId: 'channels' },
        ),
        handle: { meta: channelRouteMeta },
        path: ':channelId',
      },
    ],
    errorElement: <ErrorBoundary resetPath=".." />,
    path: 'channels',
  },
];
