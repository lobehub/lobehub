'use client';

import { Suspense } from 'react';
import { createMemoryRouter, Outlet } from 'react-router';

import Loading from '@/components/Loading/BrandTextLoading';
import TabLocationReporter from '@/features/Electron/TabHost/TabLocationReporter';
import { ErrorBoundary } from '@/utils/router';

import { createMainAreaChildren } from './desktopRouter.config';

const TabRootLayout = () => (
  <Suspense fallback={<Loading debugId="TabRootLayout > Outlet" />}>
    <Outlet />
    <TabLocationReporter />
  </Suspense>
);

export const createTabRouter = (initialUrl: string) =>
  createMemoryRouter(
    [
      {
        children: createMainAreaChildren(),
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
