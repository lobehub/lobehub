/**
 * Navigation utilities - SPA implementation via react-router-dom.
 *
 * Provides the same API surface as the previous Next.js navigation wrapper
 * so that existing consumer code does not need to change.
 */

import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';

// ---------------------------------------------------------------------------
// useRouter — compat wrapper around useNavigate
// ---------------------------------------------------------------------------
export function useRouter() {
  const navigate = useNavigate();
  return {
    back: () => navigate(-1),
    forward: () => navigate(1),
    push: (href: string) => navigate(href),
    refresh: () => navigate(0),
    replace: (href: string) => navigate(href, { replace: true }),
  };
}

// ---------------------------------------------------------------------------
// usePathname
// ---------------------------------------------------------------------------
export function usePathname(): string {
  return useLocation().pathname;
}

// ---------------------------------------------------------------------------
// Re-exports that have the same shape in react-router-dom
// ---------------------------------------------------------------------------
export { useParams, useSearchParams };

// ---------------------------------------------------------------------------
// redirect — imperative navigation (works only inside components / loaders)
// For non-component contexts, callers should throw a Response or use navigate.
// ---------------------------------------------------------------------------
export function redirect(url: string): never {
  throw new RedirectError(url);
}

class RedirectError extends Error {
  url: string;
  constructor(url: string) {
    super(`Redirect to ${url}`);
    this.url = url;
  }
}

// ---------------------------------------------------------------------------
// notFound — throw to be caught by an ErrorBoundary
// ---------------------------------------------------------------------------
export function notFound(): never {
  throw new NotFoundError();
}

class NotFoundError extends Error {
  digest = 'NEXT_NOT_FOUND';
  constructor() {
    super('Not Found');
  }
}

// ---------------------------------------------------------------------------
// Types kept for backward compat
// ---------------------------------------------------------------------------
export type RedirectType = 'push' | 'replace';
export type ReadonlyURLSearchParams = URLSearchParams;
