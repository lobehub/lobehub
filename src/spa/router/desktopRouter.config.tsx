'use client';

import type { RouteObject } from 'react-router';

import { acceptanceRouteMeta } from '@/features/Acceptance/routeMeta';
import HomeInboxRedirect from '@/features/MessageList/HomeInboxRedirect';
import { dynamicElement, dynamicLayout, ErrorBoundary } from '@/utils/router';

import { createMainAreaRouteFactory, createSharedDesktopRoutes } from './desktopRouter.shared';

export { sharedMainAreaChildren } from './desktopRouter.shared';

// Web home: the layout renders the dashboard; under the `im_layout` trial the
// index element redirects `/` to the Lobe AI conversation instead.
export const createMainAreaChildren = createMainAreaRouteFactory({
  createHomeElement: () => <HomeInboxRedirect />,
});

// Electron consumers resolve tab metadata against the same complete content
// tree. The Web root also renders this tree directly.
export const mainAreaMetaRoutes: RouteObject[] = [
  { children: createMainAreaChildren(), path: '/' },
];

const acceptanceRoute = (path: string): RouteObject => ({
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
  path,
});

// `/share/*` is served by the standalone Share app (apps/share), not this router.
const webOnlyRoutes: RouteObject[] = [
  {
    element: dynamicElement(() => import('@/routes/verify-im'), 'Desktop > VerifyIm'),
    errorElement: <ErrorBoundary />,
    path: '/verify-im',
  },

  // Acceptance renders outside the main layout, so it brings its own workspace
  // context: `/acceptance` is personal, `/:workspaceSlug/acceptance` is scoped.
  {
    children: [
      acceptanceRoute('/acceptance'),
      {
        children: [acceptanceRoute('acceptance')],
        element: dynamicLayout(
          () => import('@/routes/(main)/[workspaceSlug]/_layout'),
          'Desktop > Workspace > Acceptance Layout',
        ),
        errorElement: <ErrorBoundary />,
        path: ':workspaceSlug',
      },
    ],
    element: dynamicLayout(
      () => import('@/routes/(main)/acceptance/_layout'),
      'Desktop > Acceptance Layout',
    ),
  },
];

export const desktopRoutes: RouteObject[] = createSharedDesktopRoutes({
  mainAreaChildren: createMainAreaChildren(),
  platformRoutes: webOnlyRoutes,
});
