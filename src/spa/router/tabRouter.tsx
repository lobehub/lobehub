'use client';

import { Suspense } from 'react';
import { createMemoryRouter, Outlet } from 'react-router';

import RouteSegmentSkeleton from '@/components/Skeleton/RouteSegment';
import TabLocationReporter from '@/features/Electron/TabHost/TabLocationReporter';
import { ErrorBoundary } from '@/utils/router';

import { createMainAreaChildren } from './desktopRouter.config';
import { withSegmentFallback } from './desktopRouter.shared';

const TabRootLayout = () => (
  <Suspense fallback={<RouteSegmentSkeleton />}>
    <Outlet />
    <TabLocationReporter />
  </Suspense>
);

export const createTabRouter = (initialUrl: string) =>
  createMemoryRouter(
    [
      {
        // Per-tab routers bypass `createSharedDesktopRoutes`, so the main-area
        // fallback rewrite has to be applied here too.
        children: withSegmentFallback(createMainAreaChildren()),
        element: <TabRootLayout />,
        // The error element replaces `TabRootLayout`, so the reporter is repeated
        // here: the memory router has already advanced to the failing url, and
        // without a report the tab store and window url keep describing the
        // previous page (stale title, and Retry reloading the wrong route).
        errorElement: (
          <>
            <ErrorBoundary />
            <TabLocationReporter />
          </>
        ),
        path: '/',
      },
    ],
    { initialEntries: [initialUrl] },
  );
