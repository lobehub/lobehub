/**
 * `Cache-Control` helpers for backend routes whose responses are scoped to the
 * caller's credentials (Oidc-Auth / session cookie / API key). Without
 * `no-store`, HTTP caches along the way — the desktop shell's Chromium disk
 * cache (`netFetch` inside `protocol.handle`), browser profile caches, and
 * shared proxies/CDNs — may persist user data (decrypted keyVaults included)
 * to disk or serve it to a different caller.
 */

/**
 * Return a response marked `Cache-Control: no-store`. A response that already
 * declares a cache policy of its own (public assets, immutable files, SSE
 * streams, OIDC endpoints) is returned untouched.
 */
export const withNoStore = (response: Response): Response => {
  if (response.headers.has('Cache-Control')) return response;

  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
};
