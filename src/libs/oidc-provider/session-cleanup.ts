import type { LobeChatDatabase } from '@lobechat/database';
import { oidcSessions } from '@lobechat/database/schemas';
import { eq } from 'drizzle-orm';

import {
  OIDC_SESSION_COOKIE_NAME,
  OIDC_SESSION_COOKIE_NAMES,
  verifyOIDCCookieSignature,
} from './cookies';

interface OIDCSessionCookieContext {
  getCookie: (name: string) => string | null;
  setCookie: (
    name: string,
    value: string,
    options: { expires: Date; httpOnly: boolean; path: string },
  ) => unknown;
}

const expireOIDCSessionCookies = (context: OIDCSessionCookieContext) => {
  for (const name of OIDC_SESSION_COOKIE_NAMES) {
    context.setCookie(name, '', {
      expires: new Date(0),
      httpOnly: true,
      path: '/',
    });
  }
};

/**
 * Clears a stale OIDC session before Better Auth establishes a different user session.
 *
 * Only the session referenced by the current browser is removed. Sessions on other devices and
 * persistent grants remain untouched.
 */
export const clearMismatchedOIDCSession = async (
  db: LobeChatDatabase,
  userId: string,
  context: OIDCSessionCookieContext | null,
) => {
  if (!context) return false;

  const sessionId = context.getCookie(OIDC_SESSION_COOKIE_NAME);
  if (!sessionId) return false;

  const signature = context.getCookie(`${OIDC_SESSION_COOKIE_NAME}.sig`);
  if (!signature || !verifyOIDCCookieSignature(OIDC_SESSION_COOKIE_NAME, sessionId, signature)) {
    expireOIDCSessionCookies(context);
    return true;
  }

  const [session] = await db
    .select({ userId: oidcSessions.userId })
    .from(oidcSessions)
    .where(eq(oidcSessions.id, sessionId))
    .limit(1);

  if (session?.userId === userId) return false;

  if (session) {
    await db.delete(oidcSessions).where(eq(oidcSessions.id, sessionId));
  }

  expireOIDCSessionCookies(context);
  return true;
};
