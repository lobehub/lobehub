/**
 * Base URL for OAuth callbacks and redirects when APP_URL is a bind address.
 * Uses X-Forwarded-* (proxy), then Origin/Referer (e.g. tunnel), so OAuth providers
 * and users are sent to a reachable URL instead of 0.0.0.0.
 */

export function isBindAddress(host: string): boolean {
  const h = host.toLowerCase();
  return h === '0.0.0.0' || h === '127.0.0.1' || h === 'localhost' || h.startsWith('127.');
}

/**
 * Returns the public base URL for redirects. When appUrl has a bind-address host,
 * tries X-Forwarded-Proto/Host, then Origin, then Referer; otherwise returns appUrl.
 */
export function getPublicBaseUrl(appUrl: string, headers: Headers): string {
  let parsed: URL;
  try {
    parsed = new URL(appUrl);
  } catch {
    return appUrl;
  }
  if (!isBindAddress(parsed.hostname)) return appUrl;

  const proto = headers.get('x-forwarded-proto') || parsed.protocol.replace(':', '');
  const forwardedHost = headers.get('x-forwarded-host');
  if (forwardedHost) return `${proto}://${forwardedHost}`;

  const origin = headers.get('origin');
  if (origin) {
    try {
      const u = new URL(origin);
      if (!isBindAddress(u.hostname)) return origin;
    } catch {
      // ignore invalid origin
    }
  }

  const referer = headers.get('referer');
  if (referer) {
    try {
      const u = new URL(referer);
      if (!isBindAddress(u.hostname)) return u.origin;
    } catch {
      // ignore invalid referer
    }
  }

  return appUrl;
}
