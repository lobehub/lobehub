/**
 * React Router navigation hooks wrapper.
 * This module provides unified navigation hooks for SPA routing.
 *
 * Usage:
 * - import { useRouter, usePathname, useSearchParams, useQuery } from '@/libs/router/navigation';
 *
 * @see RFC 147
 */
import qs from 'query-string';
import { useCallback, useMemo } from 'react';
import {
  createSearchParams,
  matchPath,
  type NavigateOptions,
  type PathPattern,
  type SetURLSearchParams,
  type URLSearchParamsInit,
  useNavigate,
} from 'react-router';
import { useShallow } from 'zustand/react/shallow';

import { routerSelectors, useRouterStore } from '@/store/router';

/**
 * Hook to get router navigation functions.
 * Provides a Next.js-like API using React Router.
 */
export const useRouter = () => {
  const navigate = useNavigate();

  return useMemo(
    () => ({
      back: () => navigate(-1),
      forward: () => navigate(1),
      // Note: prefetch is not supported in React Router
      prefetch: () => {},
      push: (href: string) => navigate(href),
      replace: (href: string) => navigate(href, { replace: true }),
    }),
    [navigate],
  );
};

/**
 * Hook to get current pathname.
 */
export const usePathname = () => {
  return useRouterStore(routerSelectors.pathname);
};

/**
 * Hook to get search params.
 * Returns [searchParams, setSearchParams] tuple similar to React Router.
 */
export const useSearchParams = () => {
  const search = useRouterStore(routerSelectors.search);
  const navigate = useNavigate();
  const searchParams = useMemo(() => createSearchParams(search), [search]);
  const setSearchParams = useCallback<SetURLSearchParams>(
    (
      nextInit?: URLSearchParamsInit | ((previous: URLSearchParams) => URLSearchParamsInit),
      options?: NavigateOptions,
    ) => {
      const next = createSearchParams(
        typeof nextInit === 'function' ? nextInit(searchParams) : nextInit,
      );
      void navigate(`?${next}`, options);
    },
    [navigate, searchParams],
  );

  return [searchParams, setSearchParams] as const;
};

/**
 * Hook to get route params.
 */
export const useParams = <
  T extends Record<string, string | undefined> = Record<string, string | undefined>,
  K extends keyof T = keyof T,
>(
  ...keys: K[]
): Readonly<Pick<T, K>> => {
  return useRouterStore(
    useShallow(
      (state) =>
        Object.fromEntries(keys.map((key) => [key, state.params[key as string]])) as Pick<T, K>,
    ),
  );
};

export const useMatch = (pattern: PathPattern | string) => {
  const pathname = usePathname();
  return useMemo(() => matchPath(pattern, pathname), [pathname, pattern]);
};

export const useMatches = () => useRouterStore(routerSelectors.matches);

/**
 * Hook to get query parameters as a parsed object.
 */
export const useQuery = () => {
  const [searchParams] = useSearchParams();
  return useMemo(() => qs.parse(searchParams.toString()), [searchParams]);
};

// Re-export types
export type { Location, NavigateFunction, Params } from 'react-router';
