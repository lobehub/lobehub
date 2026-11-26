import { serverDB } from '@lobechat/database';
import { getUserAuth } from '@lobechat/utils/server';
import debug from 'debug';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import type { OIDCSessionCookieContext } from '@/libs/oidc-provider/session-cleanup';
import { clearCurrentOIDCSession } from '@/libs/oidc-provider/session-cleanup';

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
 * Session verification and cleanup are delegated to the shared OIDC session service.
 */
export async function POST() {
  try {
    // Ensure the caller is authenticated (still has a valid better-auth session)
    const { userId } = await getUserAuth();
    if (!userId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const cookieStore = await cookies();
    const cookieWrites: Parameters<OIDCSessionCookieContext['setCookie']>[] = [];
    const cleared = await clearCurrentOIDCSession(serverDB, {
      getCookie: (name) => cookieStore.get(name)?.value ?? null,
      setCookie: (...args) => cookieWrites.push(args),
    });
    const response = NextResponse.json({ ok: true, cleared });

    for (const cookieWrite of cookieWrites) {
      response.cookies.set(...cookieWrite);
    }

    log('OIDC session cleanup completed: cleared=%s', cleared);
    return response;
  } catch (error) {
    log('Error clearing OIDC session: %O', error);
    // Non-fatal — don't block the sign-out flow
    return NextResponse.json({ ok: true, cleared: false, error: 'internal' });
  }
}
