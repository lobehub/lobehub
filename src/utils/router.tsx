'use client';

import { type ComponentType, type ReactElement } from 'react';
import { createElement, lazy, memo, Suspense, useCallback, useEffect } from 'react';
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
import { useGlobalStore } from '@/store/global';

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
    // eslint-disable-next-line @next/next/no-assign-module-variable
    const module = await importFn();
    if (typeof module === 'function') {
      return { default: module };
    }
    if ('default' in module) {
      return module as { default: ComponentType<P> };
    }
    return { default: module as unknown as ComponentType<P> };
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
    // eslint-disable-next-line @next/next/no-assign-module-variable
    const module = await importFn();
    if (typeof module === 'function') {
      return { default: module };
    }
    if ('default' in module) {
      return module as { default: ComponentType<P> };
    }
    return { default: module as unknown as ComponentType<P> };
  });

  // @ts-ignore
  return (
    <Suspense fallback={<Loading debugId={debugId || 'dynamicLayout'} />}>
      {/* @ts-ignore */}
      <LazyComponent {...({} as P)} />
    </Suspense>
  );
}

/**
 * Error boundary component for React Router
 * Displays an error page and provides a reset function to navigate to a specific path
 *
 * @example
 * import { ErrorBoundary } from '@/utils/dynamicPage';
 *
 * // In router config:
 * {
 *   path: 'chat',
 *   errorElement: <ErrorBoundary resetPath="/chat" />
 * }
 */
export interface ErrorBoundaryProps {
  resetPath: string;
}

export const ErrorBoundary = ({ resetPath }: ErrorBoundaryProps) => {
  const error = useRouteError() as Error;
  const navigate = useNavigate();

  const reset = useCallback(() => {
    navigate(resetPath);
  }, [navigate, resetPath]);

  return createElement(ErrorCapture, { error, reset });
};

/**
 * Component to register navigate function in global store
 * This allows navigation to be triggered from anywhere in the app, including stores
 *
 * @example
 * import { NavigatorRegistrar } from '@/utils/dynamicPage';
 *
 * // In router root layout:
 * const RootLayout = () => (
 *   <>
 *     <NavigatorRegistrar />
 *     <YourMainLayout />
 *   </>
 * );
 */
export const NavigatorRegistrar = memo(() => {
  const navigate = useNavigate();

  useEffect(() => {
    useGlobalStore.setState({ navigate });
    return () => {
      useGlobalStore.setState({ navigate: undefined });
    };
  }, [navigate]);

  return null;
});

/**
 * Route configuration object type (RouteObject-style for createBrowserRouter)
 */
export interface RouteConfig {
  children?: RouteConfig[];
  element?: ReactElement;
  errorElement?: ReactElement;
  // HydrateFallback is ignored in declarative mode
  HydrateFallback?: ComponentType;
  index?: boolean;
  loader?: (args: { params: Record<string, string | undefined> }) => unknown;
  path?: string;
}

export interface CreateAppRouterOptions {
  basename?: string;
}

/**
 * Create a React Router data router with root error boundary.
 * Use with <RouterProvider router={router} />.
 *
 * @example
 * const router = createAppRouter(desktopRoutes, { basename: '/app' });
 * createRoot(document.getElementById('root')!).render(
 *   <SPAGlobalProvider>
 *     <RouterProvider router={router} />
 *   </SPAGlobalProvider>
 * );
 */
export function createAppRouter(routes: RouteConfig[], options?: CreateAppRouterOptions) {
  return createBrowserRouter(
    [
      {
        children: routes as RouteObject[],
        element: (
          <BusinessGlobalProvider>
            <Outlet />
          </BusinessGlobalProvider>
        ),
        errorElement: <ErrorBoundary resetPath="/" />,
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
