/**
 * @vitest-environment node
 *
 * Runs the handoff against the real provider configuration (`createOIDCProvider`)
 * with an in-memory adapter, and redeems every code at the real token endpoint,
 * so one-time use, expiry and token-family independence are the provider's own
 * behaviour rather than mocked assertions.
 */
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type * as BusinessConst from '@lobechat/business-const';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const NATIVE_CLIENT_ID = 'native-app';
const DESKTOP_CLIENT_ID = 'lobehub-desktop';
const USER_ID = 'user_handoff';
const ISSUER = 'http://localhost:3010/oidc';
const DESKTOP_REDIRECT = 'http://localhost:3010/oidc/callback/desktop';

const { authEnvMock, users } = vi.hoisted(() => ({
  authEnvMock: { ENABLE_OIDC: true, JWKS_KEY: '' },
  users: new Map<string, { banExpires: Date | null; banned: boolean | null; id: string }>(),
}));

vi.mock('@/envs/auth', () => ({ authEnv: authEnvMock }));
vi.mock('@/config/db', () => ({ serverDBEnv: { KEY_VAULTS_SECRET: 'test-secret-key' } }));
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'http://localhost:3010' } }));
vi.mock('@/server/services/projectReview/sites', () => ({ findSiteForOrigin: vi.fn() }));
vi.mock('@/database/models/user', () => ({
  UserModel: { findById: vi.fn(async (_db: unknown, id: string) => users.get(id)) },
}));
vi.mock('@lobechat/business-const', async (importOriginal) => ({
  ...(await importOriginal<typeof BusinessConst>()),
  OIDC_NATIVE_HANDOFF: {
    from: ['lobehub-desktop'],
    to: [{ clientId: 'native-app', name: 'Native App' }],
  },
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
    async upsert(id: string, payload: any, expiresIn?: number) {
      store.set(key(this.model, id), {
        expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
        payload: { ...payload },
      });
    }
    async find(id: string) {
      const entry = store.get(key(this.model, id));
      if (!entry) return undefined;
      return entry.payload;
    }
    async findByUid(uid: string) {
      for (const [k, entry] of store) {
        if (k.startsWith(`${this.model}:`) && entry.payload.uid === uid) return entry.payload;
      }
    }
    async findByUserCode() {
      return undefined;
    }
    async consume(id: string) {
      const entry = store.get(key(this.model, id));
      if (entry) entry.payload.consumed = Math.floor(Date.now() / 1000);
    }
    async destroy(id: string) {
      store.delete(key(this.model, id));
    }
    async revokeByGrantId(grantId: string) {
      for (const [k, entry] of store) {
        if (entry.payload.grantId === grantId) store.delete(k);
      }
    }
  }

  return {
    DrizzleAdapter: { createAdapterFactory: () => MemoryAdapter },
    __store: store,
  };
});

// Imported after the mocks above.
const { ACCESS_TOKEN_GRANT_CLAIM, createOIDCProvider } =
  await import('@/libs/oidc-provider/provider');
const { __store: adapterStore } = (await import('@/libs/oidc-provider/adapter')) as any;
const {
  NATIVE_HANDOFF_CODE_TTL_SECONDS,
  NATIVE_HANDOFF_RATE_LIMIT,
  NativeHandoffError,
  NativeHandoffService,
  resetNativeHandoffLocalLimits,
} = await import('./nativeHandoff');

const base64url = (buffer: Buffer) => buffer.toString('base64url');
const createPkce = () => {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { challenge, verifier };
};
const decode = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());

let provider: Awaited<ReturnType<typeof createOIDCProvider>>;
let server: Server;
let tokenEndpoint: string;

const postToken = async (body: Record<string, string>) => {
  const response = await fetch(tokenEndpoint, {
    body: new URLSearchParams(body),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    method: 'POST',
  });
  return { body: (await response.json()) as Record<string, any>, status: response.status };
};

/** Signs the desktop app in the way its own consent flow ends: a grant, a code, an exchange. */
const signInDesktop = async (userId = USER_ID) => {
  const client = await provider.Client.find(DESKTOP_CLIENT_ID);
  const grant = new provider.Grant({ accountId: userId, clientId: DESKTOP_CLIENT_ID });
  grant.addOIDCScope('openid profile email offline_access');
  grant.addResourceScope('urn:lobehub:chat', 'openid profile email offline_access');
  const grantId = await grant.save();
  const pkce = createPkce();
  const code = await new provider.AuthorizationCode({
    accountId: userId,
    client,
    codeChallenge: pkce.challenge,
    codeChallengeMethod: 'S256',
    grantId,
    redirectUri: DESKTOP_REDIRECT,
    resource: 'urn:lobehub:chat',
    scope: 'profile email offline_access',
  }).save();
  const { body, status } = await postToken({
    client_id: DESKTOP_CLIENT_ID,
    code,
    code_verifier: pkce.verifier,
    grant_type: 'authorization_code',
    redirect_uri: DESKTOP_REDIRECT,
  });
  expect(status).toBe(200);
  return { accessToken: body.access_token as string, grantId, refreshToken: body.refresh_token };
};

const createService = (
  overrides: Partial<ConstructorParameters<typeof NativeHandoffService>[0]> = {},
) =>
  new NativeHandoffService({
    findUser: async (id) => users.get(id),
    // Same rule as production (nativeHandoffHttp.ts), read from the in-memory adapter.
    hasLiveSession: async (userId, clientId, grantId) =>
      [...adapterStore.entries()].some(
        ([key, entry]: [string, any]) =>
          key.startsWith('RefreshToken:') &&
          entry.payload.accountId === userId &&
          entry.payload.clientId === clientId &&
          entry.payload.grantId === grantId &&
          !entry.payload.consumed &&
          (!entry.expiresAt || entry.expiresAt > Date.now()),
      ),
    policy: {
      from: [DESKTOP_CLIENT_ID],
      to: [{ clientId: NATIVE_CLIENT_ID, name: 'Native App' }],
    },
    provider,
    ...overrides,
  });

const handoffRequest = (pkce = createPkce(), redirectUri = 'http://127.0.0.1:53682/callback') => ({
  request: {
    client_id: NATIVE_CLIENT_ID,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    issuer: ISSUER,
    redirect_uri: redirectUri,
    scope: 'openid profile email offline_access',
  },
  pkce,
  redirectUri,
});

const redeem = (code: string, verifier: string, redirectUri: string) =>
  postToken({
    client_id: NATIVE_CLIENT_ID,
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });

beforeAll(async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  authEnvMock.JWKS_KEY = JSON.stringify({
    keys: [{ ...privateKey.export({ format: 'jwk' }), alg: 'RS256', kid: 'test', use: 'sig' }],
  });
  provider = await createOIDCProvider({} as any);
  server = createServer(provider.callback());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  tokenEndpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/oidc/token`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
});

beforeEach(() => {
  users.set(USER_ID, { banExpires: null, banned: false, id: USER_ID });
  users.set('user_other', { banExpires: null, banned: false, id: 'user_other' });
  resetNativeHandoffLocalLimits();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('native client registration', () => {
  it('registers the distribution client as a public native client with loopback redirects', async () => {
    const client = await provider.Client.find(NATIVE_CLIENT_ID);

    expect(client?.applicationType).toBe('native');
    expect(client?.clientAuthMethod).toBe('none');
    expect(client?.grantTypeAllowed('authorization_code')).toBe(true);
    expect(client?.grantTypeAllowed('refresh_token')).toBe(true);
    // RFC 8252 §7.3: any port on the registered loopback URIs, nothing else.
    expect(client?.redirectUriAllowed('http://127.0.0.1:53682/callback')).toBe(true);
    expect(client?.redirectUriAllowed('http://[::1]:61000/callback')).toBe(true);
    expect(client?.redirectUriAllowed('http://evil.example/callback')).toBe(false);
    expect(client?.redirectUriAllowed('http://127.0.0.1:53682/other')).toBe(false);
  });

  it('serves the revocation and introspection endpoints under the issuer path', async () => {
    const port = (server.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/.well-known/openid-configuration`);
    const discovery = (await response.json()) as Record<string, string>;

    expect(new URL(discovery.revocation_endpoint).pathname).toBe('/oidc/token/revocation');
    expect(new URL(discovery.introspection_endpoint).pathname).toBe('/oidc/token/introspection');
  });
});

describe('NativeHandoffService', () => {
  it('issues a 60-second code that the native app redeems for its own grant and refresh token', async () => {
    const desktop = await signInDesktop();
    const { pkce, redirectUri, request } = handoffRequest();

    const issued = await createService().issue(desktop.accessToken, request, { ip: '203.0.113.5' });

    expect(issued.iss).toBe(ISSUER);
    expect(issued.expires_in).toBe(NATIVE_HANDOFF_CODE_TTL_SECONDS);

    const { body, status } = await redeem(issued.code, pkce.verifier, redirectUri);
    expect(status).toBe(200);
    expect(body.refresh_token).toEqual(expect.any(String));
    expect(body.refresh_token).not.toBe(desktop.refreshToken);

    const accessToken = decode(body.access_token);
    expect(accessToken).toMatchObject({
      aud: 'urn:lobehub:chat',
      client_id: NATIVE_CLIENT_ID,
      iss: ISSUER,
      sub: USER_ID,
    });
    const idToken = decode(body.id_token);
    expect(idToken).toMatchObject({ aud: NATIVE_CLIENT_ID, iss: ISSUER, sub: USER_ID });

    // The audit line names both clients and the user, never the code.
    const auditLine = vi
      .mocked(console.info)
      .mock.calls.find(([line]) => line === '[OIDC] native handoff issued');
    expect(auditLine).toBeDefined();
    expect(JSON.parse(auditLine![1] as string)).toMatchObject({
      from: DESKTOP_CLIENT_ID,
      ip: '203.0.113.5',
      sub: USER_ID,
      to: NATIVE_CLIENT_ID,
    });
    expect(auditLine![1]).not.toContain(issued.code);

    // The redemption at the token endpoint closes the trail, tied by grant id.
    const issuedGrantId = JSON.parse(auditLine![1] as string).grantId;
    const redeemed = vi
      .mocked(console.info)
      .mock.calls.find(([line]) => line === '[OIDC] native client code redeemed');
    expect(JSON.parse(redeemed![1] as string)).toEqual({
      clientId: NATIVE_CLIENT_ID,
      grantId: issuedGrantId,
      sub: USER_ID,
    });
  });

  it('lets a code be redeemed only once, and revokes what it issued when replayed', async () => {
    const desktop = await signInDesktop();
    const { pkce, redirectUri, request } = handoffRequest();
    const { code } = await createService().issue(desktop.accessToken, request);

    const first = await redeem(code, pkce.verifier, redirectUri);
    expect(first.status).toBe(200);

    const second = await redeem(code, pkce.verifier, redirectUri);
    expect(second.status).toBe(400);
    expect(second.body.error).toBe('invalid_grant');
    expect(console.warn).toHaveBeenCalledWith(
      '[OIDC] grant rejected',
      expect.stringContaining('authorization code already consumed'),
    );
    expect(console.warn).toHaveBeenCalledWith(
      '[OIDC] grant revoked',
      expect.stringContaining(NATIVE_CLIENT_ID),
    );

    // Replaying the code revoked the native grant it created…
    const refresh = await postToken({
      client_id: NATIVE_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: first.body.refresh_token,
    });
    expect(refresh.body.error).toBe('invalid_grant');

    // …and nothing of the desktop app's session.
    const desktopRefresh = await postToken({
      client_id: DESKTOP_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: desktop.refreshToken,
    });
    expect(desktopRefresh.status).toBe(200);
  });

  it('rejects a code redeemed after it expires', async () => {
    const desktop = await signInDesktop();
    const { pkce, redirectUri, request } = handoffRequest();
    const { code } = await createService().issue(desktop.accessToken, request);

    vi.useFakeTimers({
      now: Date.now() + (NATIVE_HANDOFF_CODE_TTL_SECONDS + 1) * 1000,
      toFake: ['Date'],
    });
    const { body, status } = await redeem(code, pkce.verifier, redirectUri);

    expect(status).toBe(400);
    expect(body.error).toBe('invalid_grant');
    expect(console.warn).toHaveBeenCalledWith(
      '[OIDC] grant rejected',
      expect.stringContaining('authorization code is expired'),
    );
  });

  it('cannot be redeemed without the native app verifier, by another client, or on another redirect', async () => {
    const desktop = await signInDesktop();
    const service = createService();

    const a = handoffRequest();
    const { code: codeA } = await service.issue(desktop.accessToken, a.request);
    expect((await redeem(codeA, createPkce().verifier, a.redirectUri)).body.error).toBe(
      'invalid_grant',
    );

    const b = handoffRequest();
    const { code: codeB } = await service.issue(desktop.accessToken, b.request);
    const asDesktop = await postToken({
      client_id: DESKTOP_CLIENT_ID,
      code: codeB,
      code_verifier: b.pkce.verifier,
      grant_type: 'authorization_code',
      redirect_uri: b.redirectUri,
    });
    expect(asDesktop.body.error).toBe('invalid_grant');

    const c = handoffRequest();
    const { code: codeC } = await service.issue(desktop.accessToken, c.request);
    expect((await redeem(codeC, c.pkce.verifier, 'http://127.0.0.1:1/callback')).body.error).toBe(
      'invalid_grant',
    );
  });

  it('keeps both token families alive while each side rotates its own refresh token', async () => {
    const desktop = await signInDesktop();
    const { pkce, redirectUri, request } = handoffRequest();
    const { code } = await createService().issue(desktop.accessToken, request);
    const native = (await redeem(code, pkce.verifier, redirectUri)).body;

    let desktopRefreshToken = desktop.refreshToken;
    let nativeRefreshToken = native.refresh_token;
    for (let round = 0; round < 3; round += 1) {
      const d = await postToken({
        client_id: DESKTOP_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: desktopRefreshToken,
      });
      const n = await postToken({
        client_id: NATIVE_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: nativeRefreshToken,
      });
      expect([d.status, n.status]).toEqual([200, 200]);
      expect(d.body.refresh_token).not.toBe(desktopRefreshToken);
      expect(n.body.refresh_token).not.toBe(nativeRefreshToken);
      desktopRefreshToken = d.body.refresh_token;
      nativeRefreshToken = n.body.refresh_token;
    }

    // Revoking the native app's refresh token (its sign-out) ends only its grant.
    const port = (server.address() as AddressInfo).port;
    const revoke = await fetch(`http://127.0.0.1:${port}/oidc/token/revocation`, {
      body: new URLSearchParams({
        client_id: NATIVE_CLIENT_ID,
        token: nativeRefreshToken,
        token_type_hint: 'refresh_token',
      }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    });
    expect(revoke.status).toBe(200);
    const afterRevoke = await postToken({
      client_id: NATIVE_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: nativeRefreshToken,
    });
    expect(afterRevoke.body.error).toBe('invalid_grant');
    const desktopStill = await postToken({
      client_id: DESKTOP_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: desktopRefreshToken,
    });
    expect(desktopStill.status).toBe(200);
  });

  it('rejects a request for another issuer', async () => {
    const desktop = await signInDesktop();
    const { request } = handoffRequest();

    await expect(
      createService().issue(desktop.accessToken, {
        ...request,
        issuer: 'https://app.lobehub.com/oidc',
      }),
    ).rejects.toMatchObject({ code: 'issuer_mismatch', status: 409 });
    expect(console.warn).toHaveBeenCalledWith(
      '[OIDC] native handoff rejected',
      expect.stringContaining('"error":"issuer_mismatch"'),
    );
  });

  it('rejects a caller token signed for another issuer', async () => {
    const desktop = await signInDesktop();
    const { request } = handoffRequest();
    const validateToken = vi.fn(async () => ({
      clientId: DESKTOP_CLIENT_ID,
      payload: { ...decode(desktop.accessToken), iss: 'https://other.example/oidc' },
      tokenData: {} as any,
      userId: USER_ID,
    }));

    await expect(
      createService({ validateToken }).issue(desktop.accessToken, request),
    ).rejects.toMatchObject({
      code: 'invalid_token',
    });
  });

  it('rejects a request when the native app is signed in as another user', async () => {
    const desktop = await signInDesktop();
    const { request } = handoffRequest();
    const service = createService();

    await expect(
      service.issue(desktop.accessToken, { ...request, sub: 'user_other' }),
    ).rejects.toMatchObject({
      code: 'user_mismatch',
      status: 409,
    });
    expect(console.warn).toHaveBeenCalledWith(
      '[OIDC] native handoff rejected',
      expect.stringContaining('"error":"user_mismatch"'),
    );
    // The same user is fine.
    await expect(
      service.issue(desktop.accessToken, { ...request, sub: USER_ID }),
    ).resolves.toHaveProperty('code');
  });

  it('only accepts callers and targets on the policy', async () => {
    const desktop = await signInDesktop();
    const { request } = handoffRequest();

    await expect(
      createService({
        policy: { from: ['lobehub-mobile'], to: [{ clientId: NATIVE_CLIENT_ID, name: 'x' }] },
      }).issue(desktop.accessToken, request),
    ).rejects.toMatchObject({ code: 'unauthorized_client' });

    await expect(
      createService().issue(desktop.accessToken, { ...request, client_id: 'lobehub-cli' }),
    ).rejects.toMatchObject({ code: 'unauthorized_client' });

    // A web client on the target list still cannot receive a loopback code.
    await expect(
      createService({
        policy: { from: [DESKTOP_CLIENT_ID], to: [{ clientId: 'lobehub-market', name: 'x' }] },
      }).issue(desktop.accessToken, { ...request, client_id: 'lobehub-market' }),
    ).rejects.toMatchObject({ code: 'unauthorized_client' });
  });

  it('is switched off with an empty policy', async () => {
    const service = createService({ policy: { from: [], to: [] } });

    expect(service.enabled).toBe(false);
    await expect(service.issue('token', handoffRequest().request)).rejects.toMatchObject({
      code: 'not_available',
      status: 404,
    });
  });

  it.each([
    [
      'a non-loopback redirect',
      { redirect_uri: 'http://evil.example:8080/callback' },
      'invalid_redirect_uri',
    ],
    [
      'an unregistered loopback path',
      { redirect_uri: 'http://127.0.0.1:5000/steal' },
      'invalid_redirect_uri',
    ],
    ['a plain challenge', { code_challenge_method: 'plain' }, 'invalid_request'],
    ['a short challenge', { code_challenge: 'abc' }, 'invalid_request'],
    ['a scope outside the handoff set', { scope: 'openid acceptance:review' }, 'invalid_scope'],
    ['a scope without openid', { scope: 'profile' }, 'invalid_scope'],
    ['another resource', { resource: 'urn:lobehub:other' }, 'invalid_target'],
    ['no issuer', { issuer: undefined }, 'invalid_request'],
  ])('rejects %s', async (_label, patch, code) => {
    const desktop = await signInDesktop();
    const { request } = handoffRequest();

    await expect(
      createService().issue(desktop.accessToken, { ...request, ...patch }),
    ).rejects.toMatchObject({ code });
  });

  it('rejects a still-valid access token whose desktop session was revoked', async () => {
    users.set('user_revoked', { banExpires: null, banned: false, id: 'user_revoked' });
    const desktop = await signInDesktop('user_revoked');
    const service = createService();
    const { request } = handoffRequest();

    // The JWT access token stays cryptographically valid after its grant is revoked…
    await provider.Grant.adapter.revokeByGrantId(desktop.grantId);

    // …but without a live desktop session it cannot mint a native grant.
    await expect(service.issue(desktop.accessToken, request)).rejects.toMatchObject({
      code: 'invalid_token',
      description: 'the caller has no active session',
    });
  });

  it('rejects a revoked session token even after the user signs in again', async () => {
    users.set('user_relogin', { banExpires: null, banned: false, id: 'user_relogin' });
    const revoked = await signInDesktop('user_relogin');
    await provider.Grant.adapter.revokeByGrantId(revoked.grantId);
    // A later sign-in gives the same user and client another live grant…
    const current = await signInDesktop('user_relogin');
    const service = createService();

    // …which must not vouch for the revoked grant's still-valid JWT.
    await expect(
      service.issue(revoked.accessToken, handoffRequest().request),
    ).rejects.toMatchObject({
      code: 'invalid_token',
      description: 'the caller has no active session',
    });
    await expect(
      service.issue(current.accessToken, handoffRequest().request),
    ).resolves.toMatchObject({ code: expect.any(String) });
  });

  it('rejects a caller token that names no grant', async () => {
    const desktop = await signInDesktop();
    const { [ACCESS_TOKEN_GRANT_CLAIM]: _grant, ...payload } = decode(desktop.accessToken);
    const validateToken = vi.fn(async () => ({
      clientId: DESKTOP_CLIENT_ID,
      payload,
      tokenData: {} as any,
      userId: USER_ID,
    }));

    await expect(
      createService({ validateToken }).issue(desktop.accessToken, handoffRequest().request),
    ).rejects.toMatchObject({ code: 'invalid_token' });
  });

  it('rejects a missing, forged or banned caller', async () => {
    const service = createService();
    const { request } = handoffRequest();

    await expect(service.issue(undefined, request)).rejects.toMatchObject({
      code: 'invalid_token',
      status: 401,
    });
    await expect(service.issue('not-a-jwt', request)).rejects.toMatchObject({
      code: 'invalid_token',
    });

    const desktop = await signInDesktop();
    users.set(USER_ID, { banExpires: null, banned: true, id: USER_ID });
    await expect(service.issue(desktop.accessToken, request)).rejects.toMatchObject({
      code: 'access_denied',
    });
  });

  it(`limits a user to ${5} handoffs a minute`, async () => {
    const desktop = await signInDesktop();
    const service = createService();

    for (let index = 0; index < NATIVE_HANDOFF_RATE_LIMIT; index += 1) {
      await service.issue(desktop.accessToken, handoffRequest().request);
    }
    const error = await service
      .issue(desktop.accessToken, handoffRequest().request)
      .catch((e) => e);

    expect(error).toBeInstanceOf(NativeHandoffError);
    expect(error).toMatchObject({ code: 'rate_limited', status: 429 });
    expect(console.warn).toHaveBeenCalledWith(
      '[OIDC] native handoff rejected',
      expect.stringContaining('rate_limited'),
    );
  });

  it('uses the shared counter when one is available', async () => {
    const desktop = await signInDesktop();
    const countRequest = vi.fn(async () => NATIVE_HANDOFF_RATE_LIMIT + 1);

    await expect(
      createService({ countRequest }).issue(desktop.accessToken, handoffRequest().request),
    ).rejects.toMatchObject({
      code: 'rate_limited',
    });
    expect(countRequest).toHaveBeenCalledWith(USER_ID);
  });

  it('lists the targets with their verification metadata for an authenticated caller', async () => {
    const desktop = await signInDesktop();
    const service = createService({
      policy: {
        from: [DESKTOP_CLIENT_ID],
        to: [
          {
            clientId: NATIVE_CLIENT_ID,
            name: 'Native App',
            verification: { linux: { exeDirs: ['/opt/Native'] } },
          },
        ],
      },
    });

    await expect(service.listTargets(desktop.accessToken)).resolves.toEqual({
      issuer: ISSUER,
      sub: USER_ID,
      targets: [
        {
          client_id: NATIVE_CLIENT_ID,
          name: 'Native App',
          verification: { linux: { exeDirs: ['/opt/Native'] } },
        },
      ],
    });
    await expect(service.listTargets(undefined)).rejects.toMatchObject({ code: 'invalid_token' });
  });

  it('leaves no handoff artifacts behind that belong to the desktop grant', async () => {
    const desktop = await signInDesktop();
    const { request } = handoffRequest();
    await createService().issue(desktop.accessToken, request);

    const grants = [...adapterStore.entries()]
      .filter(([key]: [string]) => key.startsWith('Grant:'))
      .map(([, entry]: [string, any]) => entry.payload);
    const nativeGrant = grants.find((grant: any) => grant.clientId === NATIVE_CLIENT_ID);

    expect(nativeGrant).toBeDefined();
    expect(nativeGrant.jti).not.toBe(desktop.grantId);
  });
});
