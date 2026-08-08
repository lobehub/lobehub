import { useTheme } from 'next-themes';
import type { ComponentType, CSSProperties, ReactElement } from 'react';
import { lazy, Suspense, useEffect } from 'react';
import type { RouteObject } from 'react-router';
import { Outlet, useRouteError } from 'react-router';

import WorkbenchShell, { WorkbenchNamespace } from '@/features/WorkbenchShell';
import WorkbenchLoading from '@/features/WorkbenchShell/WorkbenchLoading';
import { isChunkLoadError, notifyChunkError } from '@/utils/chunkError';

// Keep this helper local. Importing the shared SPA router helper would pull the
// Main SPA provider and global stores into the Workbench entry chunk.
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

const WorkbenchErrorBoundary = () => {
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

const ExitWorkbench = () => {
  useEffect(() => {
    window.location.replace('/');
  }, []);

  return <WorkbenchLoading />;
};

export const workbenchRoutes: RouteObject[] = [
  {
    children: [
      {
        element: lazyElement(() => import('@/routes/(workbench)/agent/docs/[docId]')),
        path: 'agent/:aid/docs/:docId',
      },
      {
        children: [
          {
            element: lazyElement(() => import('@/routes/(workbench)/acceptance')),
            index: true,
          },
          {
            element: lazyElement(() => import('@/routes/(workbench)/acceptance/[acceptanceId]')),
            path: ':acceptanceId',
          },
          {
            element: lazyElement(() => import('@/routes/(workbench)/acceptance/[acceptanceId]')),
            path: ':acceptanceId/check/:checkId',
          },
        ],
        element: (
          <WorkbenchNamespace namespace="verify">
            <Outlet />
          </WorkbenchNamespace>
        ),
        path: 'acceptance',
      },
      {
        element: <ExitWorkbench />,
        path: '*',
      },
    ],
    element: (
      <WorkbenchShell>
        <Suspense fallback={<WorkbenchLoading />}>
          <Outlet />
        </Suspense>
      </WorkbenchShell>
    ),
    errorElement: <WorkbenchErrorBoundary />,
    path: '/',
  },
];
