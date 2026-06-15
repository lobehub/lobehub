import { useTheme } from 'next-themes';
import type { ComponentType, CSSProperties, ReactElement } from 'react';
import { lazy, Suspense } from 'react';
import type { RouteObject } from 'react-router-dom';
import { Outlet, useRouteError } from 'react-router-dom';

import Loading from '@/components/Loading/BrandTextLoading';
import AuthShell from '@/features/AuthShell';
import { isChunkLoadError, notifyChunkError } from '@/utils/chunkError';

// Local helper on purpose: @/utils/router's dynamicElement would pull SPAGlobalProvider/global store into the auth bundle
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

const buttonStyle: CSSProperties = {
  background: 'transparent',
  border: '1px solid currentcolor',
  borderRadius: 6,
  color: 'inherit',
  cursor: 'pointer',
  font: 'inherit',
  padding: '6px 16px',
};

// Renders outside AuthShell (no i18n provider), so plain elements and English copy only
const AuthErrorBoundary = () => {
  const error = useRouteError() as Error;
  const { resolvedTheme } = useTheme();

  if (typeof window !== 'undefined' && isChunkLoadError(error)) {
    notifyChunkError();
  }

  // index.auth.html paints the body black in dark mode before React mounts
  const isDark = resolvedTheme === 'dark';

  return (
    <div
      style={{
        alignItems: 'center',
        background: isDark ? '#000' : '#f8f8f8',
        color: isDark ? '#e6e6e6' : '#1a1a1a',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'sans-serif',
        gap: 16,
        justifyContent: 'center',
        minHeight: '100dvh',
        padding: 16,
      }}
    >
      <h2 style={{ margin: 0 }}>Something went wrong</h2>
      <div style={{ display: 'flex', gap: 12 }}>
        <button style={buttonStyle} type={'button'} onClick={() => window.location.reload()}>
          Retry
        </button>
        <button
          style={buttonStyle}
          type={'button'}
          onClick={() => {
            window.location.href = '/signin';
          }}
        >
          Back to sign in
        </button>
      </div>
    </div>
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
        element: lazyElement(
          () => import('@/routes/auth/market-auth-callback'),
          'Auth > MarketAuthCallback',
        ),
        path: 'market-auth-callback',
      },
      {
        element: lazyElement(
          () => import('@/routes/auth/oauth/consent/[uid]'),
          'Auth > OAuthConsent',
        ),
        path: 'oauth/consent/:uid',
      },
      {
        element: lazyElement(() => import('@/routes/auth/oauth/device'), 'Auth > OAuthDevice'),
        path: 'oauth/device',
      },
      {
        element: lazyElement(
          () => import('@/routes/auth/oauth/device/confirm'),
          'Auth > OAuthDeviceConfirm',
        ),
        path: 'oauth/device/confirm',
      },
      {
        element: lazyElement(
          () => import('@/routes/auth/oauth/device/success'),
          'Auth > OAuthDeviceSuccess',
        ),
        path: 'oauth/device/success',
      },
      {
        element: lazyElement(
          () => import('@/routes/auth/oauth/callback/success'),
          'Auth > OAuthCallbackSuccess',
        ),
        path: 'oauth/callback/success',
      },
      {
        element: lazyElement(
          () => import('@/routes/auth/oauth/callback/social'),
          'Auth > OAuthCallbackSocial',
        ),
        path: 'oauth/callback/social',
      },
      {
        element: lazyElement(
          () => import('@/routes/auth/oauth/callback/error'),
          'Auth > OAuthCallbackError',
        ),
        path: 'oauth/callback/error',
      },
    ],
    element: (
      <AuthShell>
        <Outlet />
      </AuthShell>
    ),
    errorElement: <AuthErrorBoundary />,
    path: '/',
  },
];
