'use client';

import { Suspense } from 'react';
import { createMemoryRouter, Outlet } from 'react-router';

import Loading from '@/components/Loading/BrandTextLoading';
import { ErrorBoundary } from '@/utils/router';

import { createMainAreaChildren } from './desktopRouter.config';

const TabRootLayout = () => (
  <Suspense fallback={<Loading debugId="TabRootLayout > Outlet" />}>
    <Outlet />
  </Suspense>
);

export const createTabRouter = (initialUrl: string) =>
  createMemoryRouter(
    [
      {
        children: createMainAreaChildren(),
        element: <TabRootLayout />,
        errorElement: <ErrorBoundary />,
        path: '/',
      },
    ],
    { initialEntries: [initialUrl] },
  );
