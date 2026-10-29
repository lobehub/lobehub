const FILE_PROXY_PATH = /^\/f\/[\w-]+$/;

/**
 * Point a `/f/:id` file-proxy URL at the current origin before fetching it.
 *
 * The server builds proxy URLs from `APP_URL`, which can differ from the host the
 * SPA runs on (e.g. `app.lobehub.com` vs `lobehub.com`). The proxy answers with a
 * 302 to signed storage and sends no CORS headers, so a cross-origin `fetch` of it
 * fails. Same-origin, the redirect keeps the page Origin, which bucket CORS allows.
 */
export const toSameOriginFileProxyUrl = (url: string): string => {
  if (typeof window === 'undefined') return url;

  try {
    const parsed = new URL(url, window.location.href);
    if (parsed.origin === window.location.origin) return url;
    if (!['http:', 'https:'].includes(parsed.protocol)) return url;
    if (parsed.search || !FILE_PROXY_PATH.test(parsed.pathname)) return url;

    return `${window.location.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
};
