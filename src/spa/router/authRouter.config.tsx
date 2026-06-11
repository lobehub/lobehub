import type { ComponentType, ReactElement } from 'react';
import { lazy, Suspense } from 'react';
import type { RouteObject } from 'react-router-dom';
import { Outlet } from 'react-router-dom';

import Loading from '@/components/Loading/BrandTextLoading';
import AuthShell from '@/features/AuthShell';

const lazyElement = (
  importFn: () => Promise<{ default: ComponentType }>,
  debugId: string,
): ReactElement => {
  const LazyComponent = lazy(importFn);

  return (
    <Suspense fallback={<Loading debugId={debugId} />}>
      <LazyComponent />
    </Suspense>
  );
};

export const authRoutes: RouteObject[] = [
  {
    children: [
      {
        element: lazyElement(() => import('@/routes/auth/signin'), 'Auth > SignIn'),
        path: 'signin',
      },
      {
        element: lazyElement(() => import('@/routes/auth/signup'), 'Auth > SignUp'),
        path: 'signup',
      },
      {
        element: lazyElement(() => import('@/routes/auth/verify-email'), 'Auth > VerifyEmail'),
        path: 'verify-email',
      },
      {
        element: lazyElement(() => import('@/routes/auth/reset-password'), 'Auth > ResetPassword'),
        path: 'reset-password',
      },
      {
        element: lazyElement(() => import('@/routes/auth/auth-error'), 'Auth > AuthError'),
        path: 'auth-error',
      },
      {
        element: lazyElement(() => import('@/routes/auth/verify-im'), 'Auth > VerifyIm'),
        path: 'verify-im',
      },
      {
        element: lazyElement(
          () => import('@/routes/auth/market-auth-callback'),
          'Auth > MarketAuthCallback',
        ),
        path: 'market-auth-callback',
      },
    ],
    element: (
      <AuthShell>
        <Outlet />
      </AuthShell>
    ),
    path: '/',
  },
];
