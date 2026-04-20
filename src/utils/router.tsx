'use client';

import { ThemeProvider } from '@lobehub/ui';
import { type ComponentType, type ReactElement } from 'react';
import { lazy, memo, Suspense, useLayoutEffect } from 'react';
import type { RouteObject } from 'react-router-dom';
import {
  createBrowserRouter,
  Navigate,
  Outlet,
  useNavigate,
  useRouteError,
} from 'react-router-dom';

import BusinessGlobalProvider from '@/business/client/BusinessGlobalProvider';
import ErrorCapture from '@/components/Error';
import Loading from '@/components/Loading/BrandTextLoading';
import SPAGlobalProvider from '@/layout/SPAGlobalProvider';
import { useGlobalStore } from '@/store/global';
import { createNavigationRef } from '@/store/global/initialState';
import { isChunkLoadError, notifyChunkError } from '@/utils/chunkError';

async function importModule<T>(importFn: () => Promise<T>): Promise<T> {
  return importFn();
}

function resolveLazyModule<P>(module: { default: ComponentType<P> } | ComponentType<P>) {
  if (module == null) {
    throw new Error(
      'Dynamic import resolved to undefined. This usually means a chunk failed to load.',
    );
  }
  if (typeof module === 'function') {
    return { default: module };
  }
  if ('default' in module) {
    return module as { default: ComponentType<P> };
  }
  return { default: module as unknown as ComponentType<P> };
}

/**
 * Helper function to create a dynamic page element directly for router configuration
 * This eliminates the need to define const for each component
 *
 * @example
 * // Instead of:
 * // const ChatPage = dynamicPage(() => import('./chat'));
 * // element: <ChatPage />
 *
 * // You can now use:
 * // element: dynamicElement(() => import('./chat'))
 */
export function dynamicElement<P = NonNullable<unknown>>(
  importFn: () => Promise<{ default: ComponentType<P> } | ComponentType<P>>,
  debugId?: string,
): ReactElement {
  const LazyComponent = lazy(async () => {
    const mod = await importModule(importFn);
    return resolveLazyModule(mod);
  });

  // @ts-ignore
  return (
    <Suspense fallback={<Loading debugId={debugId || 'dynamicElement'} />}>
      {/* @ts-ignore */}
      <LazyComponent {...({} as P)} />
    </Suspense>
  );
}

/**
 * Helper function to create a lazy-loaded layout element for router configuration.
 * Unlike dynamicElement (for pages), layouts use Outlet so children are rendered inside.
 */
export function dynamicLayout<P = NonNullable<unknown>>(
  importFn: () => Promise<{ default: ComponentType<P> } | ComponentType<P>>,
  debugId?: string,
): ReactElement {
  const LazyComponent = lazy(async () => {
    const mod = await importModule(importFn);
    return resolveLazyModule(mod);
  });

  // @ts-ignore
  return (
    <Suspense fallback={<Loading debugId={debugId || 'dynamicLayout'} />}>
      {/* @ts-ignore */}
      <LazyComponent {...({} as P)} />
    </Suspense>
  );
}

export interface ErrorBoundaryProps {
  /** Base path for "back home" on the error screen (defaults to `/`). */
  resetPath?: string;
}

export const ErrorBoundary = ({ resetPath }: ErrorBoundaryProps) => {
  const error = useRouteError() as Error;

  if (typeof window !== 'undefined' && isChunkLoadError(error)) {
    notifyChunkError();
  }

  return (
    <ThemeProvider theme={{ cssVar: { key: 'lobe-vars' } }}>
      <ErrorCapture error={error} resetPath={resetPath} />
    </ThemeProvider>
  );
};

/**
 * Syncs React Router's `navigate` into `navigationRef` (see `getStableNavigate` / `useStableNavigate`).
 * Mounted once on {@link RouterRoot} so imperative navigation works app-wide (desktop + mobile).
 */
export const NavigatorRegistrar = memo(() => {
  const navigate = useNavigate();

  useLayoutEffect(() => {
    useGlobalStore.setState({ navigationRef: { current: navigate } });
    return () => {
      useGlobalStore.setState({ navigationRef: createNavigationRef() });
    };
  }, [navigate]);

  return null;
});

export interface CreateAppRouterOptions {
  basename?: string;
}

const RouterRoot = memo(() => (
  <SPAGlobalProvider>
    <BusinessGlobalProvider>
      <NavigatorRegistrar />
      <Outlet />
    </BusinessGlobalProvider>
  </SPAGlobalProvider>
));

RouterRoot.displayName = 'RouterRoot';

/**
 * Create a React Router data router with root error boundary.
 * Use with <RouterProvider router={router} />.
 *
 * @example
 * const router = createAppRouter(desktopRoutes, { basename: '/app' });
 * createRoot(document.getElementById('root')!).render(
 *   <RouterProvider router={router} />
 * );
 */
export function createAppRouter(routes: RouteObject[], options?: CreateAppRouterOptions) {
  return createBrowserRouter(
    [
      {
        children: routes,
        element: <RouterRoot />,
        errorElement: <ErrorBoundary />,
        path: '/',
      },
    ],
    { basename: options?.basename },
  );
}

/**
 * Create a redirect element for use in route config
 * Replaces loader: () => redirect('/path') in declarative mode
 */
export function redirectElement(to: string): ReactElement {
  return <Navigate replace to={to} />;
}

/**
 * Prefetch route layout chunks on hover to reduce navigation delay.
 * Each import is only triggered once — subsequent calls are no-ops.
 */
const prefetchedRoutes = new Set<string>();

const routePrefetchMap: Record<string, () => Promise<unknown>> = {
  '/agent': () => import('@/routes/(main)/agent/_layout'),
  '/community': () => import('@/routes/(main)/community/_layout'),
  '/group': () => import('@/routes/(main)/group/_layout'),
  '/page': () => import('@/routes/(main)/page/_layout'),
  '/resource': () => import('@/routes/(main)/resource/_layout'),
  '/settings': () => import('@/routes/(main)/settings/_layout'),
};

export function prefetchRoute(path: string): void {
  // Match the first path segment, e.g. "/settings/provider" -> "/settings"
  const key = '/' + path.replace(/^\//, '').split('/')[0];
  if (prefetchedRoutes.has(key)) return;
  const loader = routePrefetchMap[key];
  if (loader) {
    prefetchedRoutes.add(key);
    loader();
  }
}
