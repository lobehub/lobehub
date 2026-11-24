import type { Context, Next } from 'hono';

/**
 * Credential-scoped API responses must never be persisted by HTTP caches — the
 * desktop shell's Chromium disk cache, browser profile caches, and shared
 * proxies/CDNs would otherwise store user data to disk or serve it to a
 * different caller.
 *
 * `no-store` is the default; a handler that declares its own cache policy is
 * left untouched.
 */
export const noStoreMiddleware = async (c: Context, next: Next) => {
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
