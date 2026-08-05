'use client';

import type { RouteObject } from 'react-router';

import {
  acceptanceRouteMeta,
  verifyReportsRouteMeta,
  verifyRouteMeta,
} from '@/features/Verify/routeMeta';
import { sharePageRouteMeta } from '@/routes/share/page/[id]/routeMeta';
import { shareTopicRouteMeta } from '@/routes/share/t/[id]/routeMeta';
import { loadRouteWithBuiltinToolSurfaces } from '@/spa/initialize/toolSurfaces';
import { dynamicElement, ErrorBoundary } from '@/utils/router';

import { createMainAreaRouteFactory, createSharedDesktopRoutes } from './desktopRouter.shared';

export { sharedMainAreaChildren } from './desktopRouter.shared';

export const createMainAreaChildren = createMainAreaRouteFactory();

// Electron consumers resolve tab metadata against the same complete content
// tree. The Web root also renders this tree directly.
export const mainAreaMetaRoutes: RouteObject[] = [
  { children: createMainAreaChildren(), path: '/' },
];

const webOnlyRoutes: RouteObject[] = [
  // Share topic route (outside main layout)
  {
    children: [
      {
        element: dynamicElement(
          () => loadRouteWithBuiltinToolSurfaces(() => import('@/routes/share/t/[id]')),
          'Desktop > Share > Topic',
        ),
        handle: { meta: shareTopicRouteMeta },
        path: ':id',
      },
    ],
    element: dynamicElement(
      () => import('@/routes/share/t/[id]/_layout'),
      'Desktop > Share > Topic > Layout',
    ),
    path: '/share/t',
  },

  // Share page route (outside main layout)
  {
    children: [
      {
        element: dynamicElement(() => import('@/routes/share/page/[id]'), 'Desktop > Share > Page'),
        handle: { meta: sharePageRouteMeta },
        path: ':id',
      },
    ],
    path: '/share/page',
  },

  {
    element: dynamicElement(() => import('@/routes/verify-im'), 'Desktop > VerifyIm'),
    errorElement: <ErrorBoundary />,
    path: '/verify-im',
  },

  // Verify report workspace — standalone master-detail (outside main layout)
  {
    children: [
      {
        element: dynamicElement(
          () => import('@/routes/(main)/verify/empty'),
          'Desktop > Verify Empty',
        ),
        index: true,
      },
      {
        element: dynamicElement(() => import('@/routes/verify/[runId]'), 'Desktop > VerifyReport'),
        handle: { meta: verifyRouteMeta },
        path: ':runId',
      },
    ],
    element: dynamicElement(() => import('@/routes/(main)/verify'), 'Desktop > Verify'),
    errorElement: <ErrorBoundary />,
    handle: { meta: verifyReportsRouteMeta },
    path: '/verify',
  },

  // Subject-level delivery acceptance — the verify workspace's twin: a
  // master-detail with the acceptance list on the left.
  {
    children: [
      {
        element: dynamicElement(
          () => import('@/routes/(main)/acceptance/empty'),
          'Desktop > Acceptance Empty',
        ),
        index: true,
      },
      {
        element: dynamicElement(
          () => import('@/routes/acceptance/[acceptanceId]'),
          'Desktop > AcceptanceReport',
        ),
        handle: { meta: acceptanceRouteMeta },
        path: ':acceptanceId',
      },
      {
        element: dynamicElement(
          () => import('@/routes/acceptance/[acceptanceId]'),
          'Desktop > AcceptanceCheck',
        ),
        handle: { meta: acceptanceRouteMeta },
        path: ':acceptanceId/check/:checkId',
      },
    ],
    element: dynamicElement(() => import('@/routes/(main)/acceptance'), 'Desktop > Acceptance'),
    errorElement: <ErrorBoundary />,
    handle: { meta: acceptanceRouteMeta },
    path: '/acceptance',
  },
];

export const desktopRoutes: RouteObject[] = createSharedDesktopRoutes({
  mainAreaChildren: createMainAreaChildren(),
  onboardingRoute: {
    element: dynamicElement(() => import('@/routes/onboarding'), 'Desktop > Onboarding'),
    errorElement: <ErrorBoundary />,
    path: '/onboarding',
  },
  platformRoutes: webOnlyRoutes,
});
