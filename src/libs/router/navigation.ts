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
import { useMemo } from 'react';
import {
  useLocation,
  useNavigate,
  useParams as useReactRouterParams,
  useSearchParams as useReactRouterSearchParams,
} from 'react-router-dom';

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
  const location = useLocation();
  return location.pathname;
};

/**
 * Hook to get search params.
 * Returns [searchParams, setSearchParams] tuple similar to React Router.
 */
export const useSearchParams = () => {
  return useReactRouterSearchParams();
};

/**
 * Hook to get route params.
 */
export const useParams = <
  T extends Record<string, string | undefined> = Record<string, string | undefined>,
>() => {
  return useReactRouterParams<T>();
};

/**
 * Hook to get query parameters as a parsed object.
 */
export const useQuery = () => {
  const [searchParams] = useReactRouterSearchParams();
  return useMemo(() => qs.parse(searchParams.toString()), [searchParams]);
};

// Re-export types
export type { Location, NavigateFunction, Params } from 'react-router-dom';
