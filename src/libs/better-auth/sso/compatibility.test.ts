// @vitest-environment node
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { genericOAuth } from 'better-auth/plugins';
import { describe, expect, it } from 'vitest';

const BASE_URL = 'http://localhost:3000';
const PROVIDER_ID = 'custom-oauth';

const createAuth = () => {
  const db: Record<string, any[]> = { account: [], session: [], user: [], verification: [] };
  const auth = betterAuth({
    baseURL: BASE_URL,
    database: memoryAdapter(db),
    emailAndPassword: { enabled: true },
    plugins: [
      genericOAuth({
        config: [
          {
            authorizationUrl: 'https://provider.example.com/authorize',
            clientId: 'test-client',
            clientSecret: 'test-client-secret',
            getToken: async () => ({ accessToken: 'fixture-access-token' }),
            // Match LobeHub's custom providers: a raw profile, not { user, data }.
            getUserInfo: async () => ({
              email: 'user@example.com',
              emailVerified: true,
              id: 'provider-subject',
              name: 'User',
            }),
            pkce: false,
            providerId: PROVIDER_ID,
            redirectURI: `${BASE_URL}/api/auth/callback/${PROVIDER_ID}`,
          },
        ],
      }),
    ],
    secret: 'test-secret-test-secret-test-secret',
  });

  return { auth, db };
};

const cookies = (headers: Headers) =>
  headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');

const completeOAuth = async (
  auth: ReturnType<typeof createAuth>['auth'],
  endpoint: '/sign-in/social' | '/link-social',
  sessionCookie = '',
) => {
  const response = await auth.handler(
    new Request(`${BASE_URL}/api/auth${endpoint}`, {
      body: JSON.stringify({ callbackURL: `${BASE_URL}/profile`, provider: PROVIDER_ID }),
      headers: { 'content-type': 'application/json', 'cookie': sessionCookie, 'origin': BASE_URL },
      method: 'POST',
    }),
  );
  expect(response.status).toBe(200);
  const authorizationURL = new URL((await response.json()).url);
  expect(authorizationURL.searchParams.get('redirect_uri')).toBe(
    `${BASE_URL}/api/auth/callback/${PROVIDER_ID}`,
  );
  expect(authorizationURL.searchParams.has('code_challenge')).toBe(false);

  const callbackURL = new URL(`${BASE_URL}/api/auth/callback/${PROVIDER_ID}`);
  callbackURL.searchParams.set('code', 'fixture-code');
  callbackURL.searchParams.set('state', authorizationURL.searchParams.get('state')!);
  const callback = await auth.handler(
    new Request(callbackURL, {
      headers: { cookie: [sessionCookie, cookies(response.headers)].filter(Boolean).join('; ') },
    }),
  );
  expect(callback.status).toBe(302);
  expect(callback.headers.get('location')).toBe(`${BASE_URL}/profile`);

  return callback;
};

describe('Better Auth 1.7 generic provider compatibility', () => {
  it('signs in through the social endpoint with the existing callback and raw profile', async () => {
    const { auth, db } = createAuth();

    await completeOAuth(auth, '/sign-in/social');

    expect(db.user).toHaveLength(1);
    expect(db.account).toHaveLength(1);
    expect(db.account[0]).toMatchObject({
      accountId: 'provider-subject',
      providerId: PROVIDER_ID,
      userId: db.user[0].id,
    });
  });

  it('links, reads, and unlinks a generic account using its local row ID', async () => {
    const { auth, db } = createAuth();
    const signUp = await auth.api.signUpEmail({
      body: { email: 'user@example.com', name: 'User', password: 'password-123456' },
      returnHeaders: true,
    });
    const sessionCookie = cookies(signUp.headers);

    await completeOAuth(auth, '/link-social', sessionCookie);

    expect(db.user).toHaveLength(1);
    const headers = new Headers({ cookie: sessionCookie, origin: BASE_URL });
    const accounts = await auth.api.listUserAccounts({ headers });
    const account = accounts.find((item) => item.providerId === PROVIDER_ID)!;
    expect(account.id).not.toBe(account.accountId);
    expect(await auth.api.accountInfo({ headers, query: { accountId: account.id } })).toMatchObject(
      {
        user: { email: 'user@example.com' },
      },
    );
    await auth.api.unlinkAccount({ body: { accountId: account.id }, headers });
    expect(db.account).toHaveLength(1);
    expect(db.account[0].providerId).toBe('credential');
  });
});
