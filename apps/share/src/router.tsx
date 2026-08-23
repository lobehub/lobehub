import { useTheme } from 'next-themes';
import type { ComponentType, CSSProperties, ReactElement } from 'react';
import { lazy, Suspense, useEffect } from 'react';
import type { RouteObject } from 'react-router';
import { Outlet, useRouteError } from 'react-router';

import { isChunkLoadError, notifyChunkError } from '@/utils/chunkError';

import ShareAppShell, { ShareNamespace } from './shell';
import ShareLoading from './shell/ShareLoading';

const lazyElement = (importFn: () => Promise<{ default: ComponentType }>): ReactElement => {
  const LazyComponent = lazy(importFn);

  return <LazyComponent />;
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

const ShareErrorBoundary = () => {
  const error = useRouteError() as Error;
  const { resolvedTheme } = useTheme();

  if (typeof window !== 'undefined' && isChunkLoadError(error)) notifyChunkError();

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
        <button style={buttonStyle} type={'button'} onClick={() => window.location.assign('/')}>
          Back
        </button>
      </div>
    </div>
  );
};

const ExitShare = () => {
  useEffect(() => {
    window.location.replace('/');
  }, []);

  return <ShareLoading />;
};

export const shareRoutes: RouteObject[] = [
  {
    children: [
      {
        element: lazyElement(() => import('./features/topic/SharedTopicView')),
        path: 'share/t/:id',
      },
      {
        element: lazyElement(() => import('./features/page/SharedPageView')),
        path: 'share/page/:id',
      },
      {
        element: <ExitShare />,
        path: '*',
      },
    ],
    element: (
      <ShareAppShell>
        <ShareNamespace namespace="chat">
          <Suspense fallback={<ShareLoading />}>
            <Outlet />
          </Suspense>
        </ShareNamespace>
      </ShareAppShell>
    ),
    errorElement: <ShareErrorBoundary />,
    path: '/',
  },
];
