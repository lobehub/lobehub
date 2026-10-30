import { createAuthMiddleware } from 'better-auth/api';
import { type BetterAuthPlugin } from 'better-auth/types';

/**
 * Makes the deferred session refresh (`POST /get-session`) actually refresh.
 *
 * With `deferSessionRefresh`, the client's `GET /get-session` writes the `session_data` cookie
 * cache and returns `needsRefresh`. Better Auth then serves the client's follow-up POST from that
 * fresh cache and returns before its refresh logic, so the session would never slide and would
 * expire 7 days after sign-in. Bypassing the cache on this POST lets it read the stored session
 * and re-issue the session cookie. Still unfixed upstream as of better-auth 1.8.0-beta.3.
 */
export const deferredSessionRefresh = (): BetterAuthPlugin => ({
  hooks: {
    before: [
      {
        handler: createAuthMiddleware(async (ctx) => ({
          context: { query: { ...ctx.query, disableCookieCache: true } },
        })),
        matcher: (ctx) => ctx.path === '/get-session' && ctx.request?.method === 'POST',
      },
    ],
  },
  id: 'deferred-session-refresh',
});
