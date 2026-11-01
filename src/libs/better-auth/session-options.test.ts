// @vitest-environment node
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deferredSessionRefresh } from './plugins/deferred-session-refresh';
import { stripEmptyUntypedBody } from './request-body';
import { sessionOptions } from './session-options';

const BASE_URL = 'http://localhost:3000';
const DAY = 24 * 60 * 60 * 1000;
const SESSION_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60;

/**
 * A real Better Auth instance using the production session options, so the test exercises
 * the actual refresh rules rather than asserting the config shape.
 */
const createAuth = (plugins = [deferredSessionRefresh()]) => {
  const db: Record<string, any[]> = { account: [], session: [], user: [], verification: [] };
  const auth = betterAuth({
    baseURL: BASE_URL,
    database: memoryAdapter(db),
    emailAndPassword: { enabled: true },
    plugins,
    secret: 'test-secret-test-secret-test-secret',
    session: sessionOptions,
  });

  return { auth, db };
};

/**
 * The client's refresh POST as a Next.js route handler receives it: no content type, but a
 * non-null (empty) body stream.
 */
const createRefreshPost = (cookie: string) =>
  new Request(`${BASE_URL}/api/auth/get-session`, {
    body: new ReadableStream({ start: (controller) => controller.close() }),
    duplex: 'half',
    headers: { cookie, origin: BASE_URL },
    method: 'POST',
  } as RequestInit);

const getCookie = (setCookie: string | null, name: string) => {
  const match = setCookie?.match(new RegExp(`(?:^|,\\s*)(better-auth\\.${name}=[^;]+)`));
  return match?.[1];
};

const getSessionTokenMaxAge = (setCookie: string | null) => {
  const match = setCookie?.match(/better-auth\.session_token=[^;]+;[^,]*?Max-Age=(\d+)/i);
  return match ? Number(match[1]) : undefined;
};

/** Signs up, then moves past `updateAge` (1 day) so the session is due for refresh. */
const signUpAndAge = async (auth: ReturnType<typeof createAuth>['auth']) => {
  const signUp = await auth.api.signUpEmail({
    body: { email: 'user@example.com', name: 'User', password: 'password-123456' },
    returnHeaders: true,
  });
  const sessionCookie = getCookie(signUp.headers.get('set-cookie'), 'session_token');
  expect(sessionCookie).toBeDefined();

  vi.setSystemTime(new Date(Date.now() + 2 * DAY));

  return sessionCookie!;
};

describe('session refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('only slides the session when the client can receive the renewed cookie', async () => {
    const { auth, db } = createAuth();
    const sessionCookie = await signUpAndAge(auth);
    const initialExpiresAt = new Date(db.session[0].expiresAt).getTime();
    const headers = new Headers({ cookie: sessionCookie, origin: BASE_URL });

    // Server-side callers (proxy, tRPC context) drop Set-Cookie, so they must not refresh.
    const serverSession = await auth.api.getSession({ headers });
    expect(serverSession?.user.email).toBe('user@example.com');
    expect(new Date(db.session[0].expiresAt).getTime()).toBe(initialExpiresAt);

    // The browser's GET is read-only too, asks the client to refresh and caches the session.
    const getResponse = await auth.handler(
      new Request(`${BASE_URL}/api/auth/get-session`, { headers }),
    );
    expect(await getResponse.json()).toMatchObject({ needsRefresh: true });
    const getSetCookie = getResponse.headers.get('set-cookie');
    expect(getCookie(getSetCookie, 'session_token')).toBeUndefined();
    const sessionDataCookie = getCookie(getSetCookie, 'session_data');
    expect(sessionDataCookie).toBeDefined();
    expect(new Date(db.session[0].expiresAt).getTime()).toBe(initialExpiresAt);

    // The follow-up POST carries the fresh cookie cache, yet still extends the session and
    // re-issues a full-length cookie.
    const postResponse = await auth.handler(
      await stripEmptyUntypedBody(createRefreshPost(`${sessionCookie}; ${sessionDataCookie}`)),
    );
    expect(postResponse.status).toBe(200);
    const maxAge = getSessionTokenMaxAge(postResponse.headers.get('set-cookie'));
    expect(maxAge).toBeGreaterThan(SESSION_EXPIRES_IN_SECONDS - 60);
    expect(new Date(db.session[0].expiresAt).getTime()).toBeGreaterThan(
      Date.now() + SESSION_EXPIRES_IN_SECONDS * 1000 - 60_000,
    );
  });

  it('rejects the bodyless refresh POST as Next.js delivers it unless the body is dropped', async () => {
    const { auth, db } = createAuth();
    const sessionCookie = await signUpAndAge(auth);
    const initialExpiresAt = new Date(db.session[0].expiresAt).getTime();

    const response = await auth.handler(createRefreshPost(sessionCookie));

    expect(response.status).toBe(415);
    expect(new Date(db.session[0].expiresAt).getTime()).toBe(initialExpiresAt);
  });

  it('serves the refresh POST from the cookie cache without the plugin', async () => {
    const { auth, db } = createAuth([]);
    const sessionCookie = await signUpAndAge(auth);
    const initialExpiresAt = new Date(db.session[0].expiresAt).getTime();
    const getResponse = await auth.handler(
      new Request(`${BASE_URL}/api/auth/get-session`, {
        headers: { cookie: sessionCookie, origin: BASE_URL },
      }),
    );
    const sessionDataCookie = getCookie(getResponse.headers.get('set-cookie'), 'session_data');

    const postResponse = await auth.handler(
      await stripEmptyUntypedBody(createRefreshPost(`${sessionCookie}; ${sessionDataCookie}`)),
    );

    expect(postResponse.status).toBe(200);
    expect(getCookie(postResponse.headers.get('set-cookie'), 'session_token')).toBeUndefined();
    expect(new Date(db.session[0].expiresAt).getTime()).toBe(initialExpiresAt);
  });
});
