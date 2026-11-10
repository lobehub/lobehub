export const LOCAL_FILE_PROTOCOL_SCHEME = 'localfile';
export const LOCAL_FILE_PROTOCOL_HOST = 'file';

/**
 * Renderer pathnames that must be proxied to the remote LobeHub backend
 * instead of being served as static assets. Covers tRPC, webapi, NextAuth,
 * the marketplace REST + OIDC token/userinfo/handoff endpoints, and the LLM
 * relay upload channel (`/api/agent/llm-relay/:callId/{payload,chunks}`) the
 * desktop uses to run local-model calls for server-driven runs.
 *
 * `/lobehub-oidc/*` is intentionally NOT here — those URLs are handed to
 * `shell.openExternal` as fully-qualified web URLs and never reach renderer
 * `fetch`.
 */
export const BACKEND_PATH_PREFIXES = [
  '/trpc',
  '/webapi',
  '/api/auth',
  '/api/agent/llm-relay',
  '/market',
];

const matchesPrefix = (pathname: string, prefixes: string[]) =>
  prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

export const isBackendPath = (pathname: string) => matchesPrefix(pathname, BACKEND_PATH_PREFIXES);

// Canvas previews run in an opaque-origin sandbox (Origin: null); the proxy would otherwise
// attach the user's access token to whatever backend path their scripts fetch.
export const isSandboxedBackendRequestAllowed = (origin: string | null) => origin !== 'null';
