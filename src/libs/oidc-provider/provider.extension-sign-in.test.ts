/**
 * @vitest-environment node
 *
 * Boots the real provider configuration and walks the acceptance extension's
 * sign-in over HTTP, standing in for the app route that turns a web session
 * into the provider's login result.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  ACCEPTANCE_EXTENSION_CLIENT_ID,
  ACCEPTANCE_EXTENSION_IDS,
  ACCEPTANCE_EXTENSION_RESOURCE,
} from '@lobechat/const';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const USER_ID = 'user_reviewer';
const REDIRECT_URI = `https://${ACCEPTANCE_EXTENSION_IDS[0]}.chromiumapp.org/oidc`;
const SIGN_IN_PATH = '/oidc/extension-sign-in/';

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

vi.mock('@/libs/oidc-provider/adapter', () => {
  const store = ((globalThis as any).oidcTestStore = new Map<string, any>());
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

const { createOIDCProvider } = await import('./provider');

let provider: Awaited<ReturnType<typeof createOIDCProvider>>;
let server: Server;
let origin: string;

const stored = (model: string) =>
  [...((globalThis as any).oidcTestStore as Map<string, unknown>).keys()].filter((key) =>
    key.startsWith(`${model}:`),
  );

let loginAs = USER_ID;

const browser = () => {
  const jar = new Map<string, string>();
  const visit = async (path: string) => {
    const response = await fetch(origin + path, {
      headers: { cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; ') },
      redirect: 'manual',
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const at = pair!.indexOf('=');
      jar.set(pair!.slice(0, at), pair!.slice(at + 1));
    }
    const location = response.headers.get('location');
    const next = location ? new URL(location, origin) : undefined;
    return { next, status: response.status };
  };
  return { jar, visit };
};

const authorize = (extra: Record<string, string> = {}) => {
  const verifier = randomBytes(32).toString('base64url');
  const query = new URLSearchParams({
    client_id: ACCEPTANCE_EXTENSION_CLIENT_ID,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    redirect_uri: REDIRECT_URI,
    resource: ACCEPTANCE_EXTENSION_RESOURCE,
    response_type: 'code',
    scope: 'openid profile offline_access acceptance:extension',
    state: 'state-1',
    ...extra,
  });
  return { path: `/oidc/auth?${query}`, verifier };
};

const exchange = async (code: string, verifier: string) => {
  const response = await fetch(`${origin}/oidc/token`, {
    body: new URLSearchParams({
      client_id: ACCEPTANCE_EXTENSION_CLIENT_ID,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    }),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    method: 'POST',
  });
  return { body: (await response.json()) as Record<string, string>, status: response.status };
};

beforeAll(async () => {
  const { privateKey } = await crypto.subtle.generateKey(
    {
      hash: 'SHA-256',
      modulusLength: 2048,
      name: 'RSASSA-PKCS1-v1_5',
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ['sign', 'verify'],
  );
  const { key_ops: _, ...privateJwk } = await crypto.subtle.exportKey('jwk', privateKey);
  authEnvMock.JWKS_KEY = JSON.stringify({
    keys: [{ ...privateJwk, alg: 'RS256', kid: 'test', use: 'sig' }],
  });
  provider = await createOIDCProvider({} as any);
  const handle = provider.callback();
  server = createServer(async (req, res) => {
    const login = req.url?.startsWith(SIGN_IN_PATH) || req.url?.startsWith('/test/login/');
    if (login) {
      const location = await provider.interactionResult(req, res, {
        login: { accountId: loginAs, remember: true },
      });
      return void res.writeHead(303, { location }).end();
    }
    if (req.url?.startsWith('/test/consent/')) {
      const details = await provider.interactionDetails(req, res);
      const grant =
        (details.grantId && (await provider.Grant.find(details.grantId))) ||
        new provider.Grant({
          accountId: details.session!.accountId,
          clientId: details.params.client_id as string,
        });
      grant.addOIDCScope(((details.prompt.details.missingOIDCScope as string[]) ?? []).join(' '));
      const resources = (details.prompt.details.missingResourceScopes ?? {}) as Record<
        string,
        string[]
      >;
      for (const [indicator, scopes] of Object.entries(resources))
        grant.addResourceScope(indicator, scopes.join(' '));
      const location = await provider.interactionResult(req, res, {
        consent: { grantId: await grant.save() },
      });
      return void res.writeHead(303, { location }).end();
    }
    return handle(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
});

describe('acceptance extension sign-in', () => {
  it('sends a browser with no provider session to the silent sign-in route', async () => {
    const { visit } = browser();
    const { next, status } = await visit(authorize().path);

    expect(status).toBe(303);
    expect(next?.pathname.startsWith(SIGN_IN_PATH)).toBe(true);
  });

  it('finishes with a code and a refresh token once signed in, without a consent page', async () => {
    const { visit } = browser();
    const { path, verifier } = authorize();
    const signIn = await visit(path);
    const resume = await visit(signIn.next!.pathname);
    const done = await visit(resume.next!.pathname);

    expect(done.next?.origin + done.next!.pathname).toBe(REDIRECT_URI);
    expect(done.next?.searchParams.get('state')).toBe('state-1');
    const tokens = await exchange(done.next!.searchParams.get('code')!, verifier);
    expect(tokens.status).toBe(200);
    expect(tokens.body.refresh_token).toEqual(expect.any(String));

    const refreshed = await fetch(`${origin}/oidc/token`, {
      body: new URLSearchParams({
        client_id: ACCEPTANCE_EXTENSION_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: tokens.body.refresh_token!,
      }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    });
    expect(refreshed.status).toBe(200);
    expect(((await refreshed.json()) as Record<string, string>).refresh_token).toEqual(
      expect.any(String),
    );
  });

  it('still shows the consent page to an extension build that asks for it', async () => {
    const { visit } = browser();
    const signIn = await visit(authorize({ prompt: 'consent' }).path);
    const resume = await visit(signIn.next!.pathname);
    const consent = await visit(resume.next!.pathname);

    expect(consent.next?.pathname.startsWith('/oauth/consent/')).toBe(true);
  });

  it('keeps the reviewer signed in after the browser session that started it is gone', async () => {
    const { jar, visit } = browser();
    const { path, verifier } = authorize();
    const done = await visit((await visit((await visit(path)).next!.pathname)).next!.pathname);
    const tokens = await exchange(done.next!.searchParams.get('code')!, verifier);

    const sessionId = jar.get('_session')!.split('.')[0]!;
    await (await provider.Session.find(sessionId))!.destroy();

    const refreshed = await fetch(`${origin}/oidc/token`, {
      body: new URLSearchParams({
        client_id: ACCEPTANCE_EXTENSION_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: tokens.body.refresh_token!,
      }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    });
    expect(refreshed.status).toBe(200);
  });

  it('asks the web session who is signing in every time, and reuses the grant it made', async () => {
    const { visit } = browser();
    const first = authorize();
    await visit((await visit((await visit(first.path)).next!.pathname)).next!.pathname);
    const grants = stored('Grant').length;

    const again = await visit(authorize().path);
    expect(again.next?.pathname.startsWith(SIGN_IN_PATH)).toBe(true);
    const done = await visit((await visit(again.next!.pathname)).next!.pathname);

    expect(done.next?.origin + done.next!.pathname).toBe(REDIRECT_URI);
    expect(stored('Grant')).toHaveLength(grants);
  });

  it('never carries a provider session over to another account', async () => {
    const { visit } = browser();
    await visit((await visit((await visit(authorize().path)).next!.pathname)).next!.pathname);

    loginAs = 'user_other';
    try {
      const again = await visit(authorize().path);
      const resumed = await visit((await visit(again.next!.pathname)).next!.pathname);

      expect(resumed.next?.searchParams.get('code')).toBeFalsy();
    } finally {
      loginAs = USER_ID;
    }
  });

  it('lets an extension build that asks for consent finish there with a refresh token', async () => {
    const { visit } = browser();
    const { path, verifier } = authorize({ prompt: 'consent' });
    const consent = await visit((await visit((await visit(path)).next!.pathname)).next!.pathname);
    const uid = consent.next!.pathname.split('/').pop()!;
    const done = await visit((await visit(`/test/consent/${uid}`)).next!.pathname);

    const tokens = await exchange(done.next!.searchParams.get('code')!, verifier);
    expect(tokens.body.refresh_token).toEqual(expect.any(String));
  });

  it('still asks another client for consent after sign-in', async () => {
    const { visit } = browser();
    const verifier = randomBytes(32).toString('base64url');
    const query = new URLSearchParams({
      client_id: 'lobehub-desktop',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      redirect_uri: 'http://localhost:3210/oidc/callback/desktop',
      response_type: 'code',
      scope: 'openid profile',
    });
    const login = await visit(`/oidc/auth?${query}`);
    const uid = login.next!.pathname.split('/').pop()!;
    const consent = await visit((await visit(`/test/login/${uid}`)).next!.pathname);

    expect(consent.next?.pathname.startsWith('/oauth/consent/')).toBe(true);
  });

  it('keeps every other client on the consent page for sign-in', async () => {
    const { visit } = browser();
    const verifier = randomBytes(32).toString('base64url');
    const query = new URLSearchParams({
      client_id: 'lobehub-desktop',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      redirect_uri: 'http://localhost:3210/oidc/callback/desktop',
      response_type: 'code',
      scope: 'openid profile',
    });
    const { next } = await visit(`/oidc/auth?${query}`);

    expect(next?.pathname.startsWith('/oauth/consent/')).toBe(true);
  });
});
