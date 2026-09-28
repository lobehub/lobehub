/**
 * Shared rules for user-created OAuth applications.
 *
 * The same checks run on the client (form validation) and on the server (tRPC
 * input validation). Redirect URIs are the only real attack surface of a
 * self-service OAuth app: a loose rule here turns every app into an open
 * redirect that leaks authorization codes, so the server never trusts the
 * client-side pass.
 */

/** Web apps redirect back to a handful of environments at most (prod + staging + local). */
export const MAX_OAUTH_REDIRECT_URIS = 5;

export type RedirectUriIssue =
  /** Not parseable as an absolute URL. */
  | 'malformed'
  /** Plain http outside loopback, or a non-http(s) scheme. */
  | 'insecure'
  /** Carries a fragment, which is never sent to the server anyway. */
  | 'fragment'
  /** Carries userinfo credentials. */
  | 'credentials'
  /** Contains a wildcard; matching is exact by design. */
  | 'wildcard';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Validates one redirect URI.
 *
 * Returns `undefined` when the URI is acceptable, otherwise the reason it was
 * rejected so the caller can map it onto a localized message.
 */
export const validateRedirectUri = (input: string): RedirectUriIssue | undefined => {
  const value = input.trim();

  if (value.includes('*')) return 'wildcard';

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'malformed';
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'insecure';
  if (url.protocol === 'http:' && !LOOPBACK_HOSTS.has(url.hostname)) return 'insecure';
  if (url.hash) return 'fragment';
  if (url.username || url.password) return 'credentials';

  return undefined;
};

/**
 * Normalizes a submitted redirect URI list: trims, drops blanks, de-duplicates.
 *
 * Order is preserved so the UI renders the list back the way it was typed.
 */
export const normalizeRedirectUris = (input: string[]): string[] => {
  const seen = new Set<string>();

  return input
    .map((item) => item.trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
};
