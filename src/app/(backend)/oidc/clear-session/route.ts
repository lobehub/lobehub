import { serverDB } from '@lobechat/database';
import { oidcSessions } from '@lobechat/database/schemas';
import { getUserAuth } from '@lobechat/utils/server';
import debug from 'debug';
import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const log = debug('lobe-oidc:clear-session');

/**
 * POST /oidc/clear-session
 *
 * Clears the OIDC Provider session for the **current browser** only.
 *
 * Called by the frontend before `signOut()` so that when the user signs in
 * as a different account and an OIDC client later triggers `/authorize`,
 * the provider won't silently reuse the stale session that still points to
 * the old accountId.
 *
 * How it works:
 * 1. Read the `_session` cookie that `oidc-provider` sets in the browser.
 *    This cookie value is the primary key of the `oidc_sessions` table.
 * 2. Delete that single row from the database.
 * 3. Remove the `_session` and `_session.sig` cookies from the response so
 *    the browser no longer presents them.
 */
export async function POST() {
  try {
    // Ensure the caller is authenticated (still has a valid better-auth session)
    const { userId } = await getUserAuth();
    if (!userId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('_session');

    if (!sessionCookie?.value) {
      log('No _session cookie found, nothing to clear');
      return NextResponse.json({ ok: true, cleared: false });
    }

    const sessionId = sessionCookie.value;
    log('Clearing OIDC session %s for user %s', sessionId, userId);

    // Delete the OIDC session row from the database
    await serverDB.delete(oidcSessions).where(eq(oidcSessions.id, sessionId));

    // Build a response that also expires the browser cookies
    const response = NextResponse.json({ ok: true, cleared: true });

    // Clear both the session cookie and its signature cookie
    for (const name of ['_session', '_session.sig', '_session.legacy', '_session.legacy.sig']) {
      response.cookies.set(name, '', {
        expires: new Date(0),
        httpOnly: true,
        path: '/',
      });
    }

    log('OIDC session cleared successfully');
    return response;
  } catch (error) {
    log('Error clearing OIDC session: %O', error);
    // Non-fatal — don't block the sign-out flow
    return NextResponse.json({ ok: true, cleared: false, error: 'internal' });
  }
}
