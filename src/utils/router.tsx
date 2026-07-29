'use client';

import { ConfigProvider, ThemeProvider } from '@lobehub/ui';
import * as m from 'motion/react-m';
import { type ComponentType, type ReactElement } from 'react';
import { lazy, memo, Suspense } from 'react';
import type { RouteObject } from 'react-router';
import { Navigate, Outlet, useRouteError } from 'react-router';

import BusinessGlobalProvider from '@/business/client/BusinessGlobalProvider';
import ErrorCapture from '@/components/Error';
import Loading from '@/components/Loading/BrandTextLoading';
import { useIsDark } from '@/hooks/useIsDark';
import SPAGlobalProvider from '@/layout/SPAGlobalProvider';
import AppLayer from '@/spa/AppLayer';
import { registerRoutePreloadLoader } from '@/spa/router/routePreloadRegistry';
import { createSPABrowserRouter } from '@/spa/runtime';
import { isChunkLoadError, notifyChunkError } from '@/utils/chunkError';

import { NavigatorRegistrar } from './NavigatorRegistrar';

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

interface DynamicRouteOptions {
  preloadId?: string;
}

const createPreloadableComponent = <P,>(
  importFn: () => Promise<{ default: ComponentType<P> } | ComponentType<P>>,
) => {
  let loadPromise: Promise<{ default: ComponentType<P> }> | undefined;
  let ResolvedComponent: ComponentType<P> | undefined;

  const load = () => {
    if (!loadPromise) {
      loadPromise = importModule(importFn)
        .then(resolveLazyModule<P>)
        .then((module) => {
          ResolvedComponent = module.default;
          return module;
        })
        .catch((error) => {
          loadPromise = undefined;
          throw error;
        });
    }

    return loadPromise;
  };

  const LazyComponent = lazy(load);
  const PreloadableComponent = (props: P) => {
    const Component = ResolvedComponent;

    if (Component) {
      // @ts-ignore generic route props are resolved by the imported component
      return <Component {...props} />;
    }

    // @ts-ignore generic route props are resolved by the imported component
    return <LazyComponent {...props} />;
  };

  return {
    Component: PreloadableComponent,
    preload: async () => {
      await load();
    },
  };
};

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
  options?: DynamicRouteOptions,
): ReactElement {
  const { Component, preload } = createPreloadableComponent(importFn);
  if (options?.preloadId) registerRoutePreloadLoader(options.preloadId, preload);

  // @ts-ignore
  return (
    <Suspense fallback={<Loading debugId={debugId || 'dynamicElement'} />}>
      {/* @ts-ignore */}
      <Component {...({} as P)} />
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
  options?: DynamicRouteOptions,
): ReactElement {
  const { Component, preload } = createPreloadableComponent(importFn);
  if (options?.preloadId) registerRoutePreloadLoader(options.preloadId, preload);

  // @ts-ignore
  return (
    <Suspense fallback={<Loading debugId={debugId || 'dynamicLayout'} />}>
      {/* @ts-ignore */}
      <Component {...({} as P)} />
    </Suspense>
  );
}

export interface ErrorBoundaryProps {
  /** Base path for "back home" on the error screen (defaults to `/`). */
  resetPath?: string;
}

export const ErrorBoundary = ({ resetPath }: ErrorBoundaryProps) => {
  const error = useRouteError() as Error;
  const isDark = useIsDark();
  const appearance = isDark ? 'dark' : 'light';

  if (typeof window !== 'undefined' && isChunkLoadError(error)) {
    notifyChunkError();
  }

  return (
    <ThemeProvider
      appearance={appearance}
      defaultAppearance={appearance}
      defaultThemeMode={appearance}
      theme={{ cssVar: { key: 'lobe-vars' } }}
    >
      <ConfigProvider motion={m}>
        <ErrorCapture error={error} resetPath={resetPath} />
      </ConfigProvider>
    </ThemeProvider>
  );
};

export interface CreateAppRouterOptions {
  basename?: string;
}

const RouterRoot = memo(() => (
  <SPAGlobalProvider>
    <BusinessGlobalProvider>
      <NavigatorRegistrar />
      <AppLayer>
        <Outlet />
      </AppLayer>
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
  return createSPABrowserRouter(
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
