import type { MiddlewareHandler } from 'hono';

/**
 * Credential-scoped API responses must never be persisted by HTTP caches — the
 * desktop shell's Chromium disk cache (`netFetch` inside `protocol.handle`),
 * browser profile caches, and shared proxies/CDNs would otherwise store user
 * data (decrypted keyVaults included) to disk or serve it to a different
 * caller.
 *
 * `no-store` is the default; a handler that declares its own cache policy
 * (public assets, immutable files, SSE streams) is left untouched.
 */
export const noStore = (): MiddlewareHandler => async (c, next) => {
  await next();

  const res = c.res;
  if (res.headers.has('Cache-Control')) return;

  const headers = new Headers(res.headers);
  headers.set('Cache-Control', 'no-store');
  c.res = new Response(res.body, {
    headers,
    status: res.status,
    statusText: res.statusText,
  });
};
