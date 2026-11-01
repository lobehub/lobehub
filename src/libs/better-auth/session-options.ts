import { type BetterAuthOptions } from 'better-auth/minimal';

/**
 * Session behavior shared by every Better Auth instance.
 *
 * Kept free of server-only imports so the refresh contract can be exercised against a real
 * Better Auth instance in tests.
 */
export const sessionOptions = {
  cookieCache: {
    enabled: true,
    maxAge: 2 * 60, // Cache duration in seconds
  },
  /**
   * Only a client `POST /get-session` may slide the session expiry; every `GET`, including
   * server-side `auth.api.getSession()` calls, is read-only and reports `needsRefresh`.
   *
   * Without this, the proxy and tRPC context refresh the session in the database but cannot
   * forward the renewed `Set-Cookie`. The browser's own `/get-session` then sees a fresh
   * session and never re-issues the cookie, so the 7-day session cookie expires while the
   * database row is still valid and active users are signed out every week.
   *
   * The web client (`useSession`) sends the follow-up POST since better-auth 1.6.17.
   * Imperative `authClient.getSession()` callers (the Expo mobile app) must send it themselves.
   * The POST relies on `stripEmptyUntypedBody` in the auth route and the
   * `deferredSessionRefresh` plugin; without them it fails with 415 or never refreshes.
   * @see https://www.better-auth.com/docs/concepts/session-management#defer-session-refresh
   * @see https://github.com/better-auth/better-auth/issues/2115
   */
  deferSessionRefresh: true,
  // Keep a DB-backed fallback when Redis secondary storage entries are unexpectedly missing.
  storeSessionInDatabase: true,
} satisfies BetterAuthOptions['session'];
