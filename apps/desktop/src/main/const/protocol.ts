export const LOCAL_FILE_PROTOCOL_SCHEME = 'localfile';
export const LOCAL_FILE_PROTOCOL_HOST = 'file';

/**
 * Renderer pathnames that must be proxied to the remote LobeHub backend
 * instead of being served as static assets. Covers tRPC, webapi, NextAuth,
 * and the marketplace REST + OIDC token/userinfo/handoff endpoints.
 *
 * `/lobehub-oidc/*` is intentionally NOT here — those URLs are handed to
 * `shell.openExternal` as fully-qualified web URLs and never reach renderer
 * `fetch`.
 */
export const BACKEND_PATH_PREFIXES = ['/trpc', '/webapi', '/api/auth', '/market'];

export const isBackendPath = (pathname: string) =>
  BACKEND_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
