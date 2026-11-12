/**
 * @vitest-environment node
 *
 * Boots the real provider configuration (`createOIDCProvider`) with an in-memory
 * adapter and a distribution-registered native client, and talks to it over
 * HTTP: discovery, a code + PKCE sign-in, and sign-out through the advertised
 * revocation endpoint.
 */
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type * as BusinessConst from '@lobechat/business-const';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const NATIVE_CLIENT_ID = 'native-app';
const REDIRECT_URI = 'http://127.0.0.1:53682/callback';
const USER_ID = 'user_native';

const { authEnvMock } = vi.hoisted(() => ({
  authEnvMock: { ENABLE_OIDC: true, JWKS_KEY: '' },
}));

vi.mock('@/envs/auth', () => ({ authEnv: authEnvMock }));
vi.mock('@/config/db', () => ({ serverDBEnv: { KEY_VAULTS_SECRET: 'test-secret-key' } }));
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'http://localhost:3010' } }));
vi.mock('@/server/services/projectReview/sites', () => ({ findSiteForOrigin: vi.fn() }));
vi.mock('@/database/models/user', () => ({
  UserModel: {
    findById: vi.fn(async () => ({ banExpires: null, banned: false, id: USER_ID })),
  },
}));
vi.mock('@lobechat/business-const', async (importOriginal) => ({
  ...(await importOriginal<typeof BusinessConst>()),
  BUSINESS_OIDC_CLIENTS: [
    {
      application_type: 'native',
      client_id: 'native-app',
      client_name: 'Native App',
      grant_types: ['authorization_code', 'refresh_token'],
      redirect_uris: ['http://127.0.0.1/callback', 'http://[::1]/callback'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
  ],
}));

vi.mock('@/libs/oidc-provider/adapter', () => {
  const store = new Map<string, any>();
  const key = (model: string, id: string) => `${model}:${id}`;

  class MemoryAdapter {
    constructor(private readonly model: string) {}
    async upsert(id: string, payload: any) {
      store.set(key(this.model, id), { ...payload });
    }
    async find(id: string) {
      return store.get(key(this.model, id));
    }
    async findByUid(uid: string) {
      for (const [k, payload] of store) {
        if (k.startsWith(`${this.model}:`) && payload.uid === uid) return payload;
      }
    }
    async findByUserCode() {
      return undefined;
    }
    async consume(id: string) {
      const payload = store.get(key(this.model, id));
      if (payload) payload.consumed = Math.floor(Date.now() / 1000);
    }
    async destroy(id: string) {
      store.delete(key(this.model, id));
    }
    async revokeByGrantId(grantId: string) {
      for (const [k, payload] of store) {
        if (payload.grantId === grantId) store.delete(k);
      }
    }
  }

  return { DrizzleAdapter: { createAdapterFactory: () => MemoryAdapter } };
});

// Imported after the mocks above.
const { createOIDCProvider } = await import('./provider');

let provider: Awaited<ReturnType<typeof createOIDCProvider>>;
let server: Server;
let origin: string;

const form = (url: string, body: Record<string, string>) =>
  fetch(url, {
    body: new URLSearchParams(body),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    method: 'POST',
  });

/** The provider serves discovery here; the app's HTTP adapter maps the issuer-relative URL onto it. */
const discovery = async () =>
  (await (await fetch(`${origin}/.well-known/openid-configuration`)).json()) as Record<
    string,
    string
  >;

/** Ends a code + PKCE sign-in the way the consent flow does: a grant, a code, an exchange. */
const signIn = async () => {
  const client = await provider.Client.find(NATIVE_CLIENT_ID);
  const grant = new provider.Grant({ accountId: USER_ID, clientId: NATIVE_CLIENT_ID });
  grant.addOIDCScope('openid profile offline_access');
  grant.addResourceScope('urn:lobehub:chat', 'openid profile offline_access');
  const grantId = await grant.save();

  const verifier = randomBytes(32).toString('base64url');
  const code = await new provider.AuthorizationCode({
    accountId: USER_ID,
    client,
    codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
    codeChallengeMethod: 'S256',
    grantId,
    redirectUri: REDIRECT_URI,
    resource: 'urn:lobehub:chat',
    scope: 'openid profile offline_access',
  }).save();

  const response = await form(`${origin}/oidc/token`, {
    client_id: NATIVE_CLIENT_ID,
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: REDIRECT_URI,
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { access_token: string; refresh_token: string };
};

beforeAll(async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  authEnvMock.JWKS_KEY = JSON.stringify({
    keys: [{ ...privateKey.export({ format: 'jwk' }), alg: 'RS256', kid: 'test', use: 'sig' }],
  });
  provider = await createOIDCProvider({} as any);
  server = createServer(provider.callback());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
});

describe('native client endpoints', () => {
  // The provider is mounted under /oidc and receives the untouched pathname, so an
  // endpoint left at its default path (`/token/revocation`) is advertised where
  // nothing serves it, and a client's sign-out lands on the web app instead.
  it('advertises revocation and introspection under the issuer path', async () => {
    const config = await discovery();

    expect(new URL(config.revocation_endpoint).pathname).toBe('/oidc/token/revocation');
    expect(new URL(config.introspection_endpoint).pathname).toBe('/oidc/token/introspection');
  });

  it('registers the distribution client as a public native client', async () => {
    const client = await provider.Client.find(NATIVE_CLIENT_ID);

    expect(client?.applicationType).toBe('native');
    expect(client?.clientAuthMethod).toBe('none');
    expect(client?.grantTypeAllowed('refresh_token')).toBe(true);
  });

  it('lets a native client sign out by revoking its refresh token at the advertised endpoint', async () => {
    const tokens = await signIn();
    const { introspection_endpoint, revocation_endpoint } = await discovery();
    const at = (endpoint: string) => `${origin}${new URL(endpoint).pathname}`;

    const before = await form(at(introspection_endpoint), {
      client_id: NATIVE_CLIENT_ID,
      token: tokens.refresh_token,
    });
    expect(await before.json()).toMatchObject({ active: true, client_id: NATIVE_CLIENT_ID });

    const revoked = await form(at(revocation_endpoint), {
      client_id: NATIVE_CLIENT_ID,
      token: tokens.refresh_token,
      token_type_hint: 'refresh_token',
    });
    expect(revoked.status).toBe(200);

    const refresh = await form(`${origin}/oidc/token`, {
      client_id: NATIVE_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
    });
    expect(refresh.status).toBe(400);
    expect(await refresh.json()).toMatchObject({ error: 'invalid_grant' });
  });
});
