/**
 * Sign-in and sign-up URLs that bring the reader back where they were.
 *
 * `/signin` and `/signup` are auth shells outside the SPA router, so callers
 * navigate to them with a full document load rather than a router push. The
 * return path is encoded once here so every entry point agrees on the query
 * name the auth shell reads (`callbackUrl`).
 */
export type AuthReturnRoute = 'signin' | 'signup';

export const buildAuthReturnUrl = (route: AuthReturnRoute, returnPath: string) =>
  `/${route}?callbackUrl=${encodeURIComponent(returnPath)}`;

/**
 * The page the reader is on, path and query only. The host is dropped on
 * purpose: the auth shell sanitizes the callback to a same-origin path, and an
 * absolute URL would be thrown away there.
 */
export const currentReturnPath = () =>
  typeof window === 'undefined' ? '/' : window.location.pathname + window.location.search;
