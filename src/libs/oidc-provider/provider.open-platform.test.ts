/**
 * @vitest-environment node
 *
 * Boots the real provider (`createOIDCProvider`) on the real Drizzle adapter
 * over a PGlite database with every open platform switch on, and talks to it
 * over HTTP: RFC 7591 registration behind an owner-issued initial access token,
 * the registration rules, and the client_credentials grant whose token acts as
 * the client's owner.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { decodeJwt } from 'jose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { oidcAccessTokens, oidcClients, users, workspaces } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

const OWNER_ID = 'user_open_platform_owner';
const WORKSPACE_ID = 'ws_open_platform';

const { authEnvMock } = vi.hoisted(() => {
  // client secrets are encrypted at rest with the key vault secret
  process.env.KEY_VAULTS_SECRET ||= 'ZHVtbXlrZXl2YXVsdHNzZWNyZXRmb3J0ZXN0czEyMzQ=';
  return {
    authEnvMock: {
      ENABLE_OIDC: true,
      JWKS_KEY: '',
      OIDC_DYNAMIC_REGISTRATION_REQUIRE_APPROVAL: false,
      OIDC_ENABLE_API_SCOPES: true,
      OIDC_ENABLE_CLIENT_CREDENTIALS: true,
      OIDC_ENABLE_DYNAMIC_REGISTRATION: true,
    },
  };
});

vi.mock('@/envs/auth', () => ({ authEnv: authEnvMock }));
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'http://localhost:3010' } }));
vi.mock('@/server/services/projectReview/sites', () => ({ findSiteForOrigin: vi.fn() }));
vi.mock('@/database/models/user', () => ({
  UserModel: {
    findById: vi.fn(async () => ({ banExpires: null, banned: false, id: OWNER_ID })),
  },
}));

// Imported after the mocks above.
const { createOIDCProvider } = await import('./provider');
const { issueRegistrationToken } = await import('./openPlatform');
const { validateOIDCJWT } = await import('./jwt');

let db: LobeChatDatabase;
let server: Server;
let origin: string;

const register = (body: Record<string, unknown>, token?: string) =>
  fetch(`${origin}/oidc/reg`, {
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    method: 'POST',
  });

const ownerToken = async (workspaceId?: string) =>
  (await issueRegistrationToken(db, { userId: OWNER_ID, workspaceId })).token;

const machineClient = {
  client_name: 'Nightly Sync',
  grant_types: ['client_credentials'],
  redirect_uris: [],
  response_types: [],
  scope: 'agent:read chat:read',
  token_endpoint_auth_method: 'client_secret_basic',
};

const clientCredentials = (clientId: string, secret: string, scope?: string) =>
  fetch(`${origin}/oidc/token`, {
    body: new URLSearchParams({ grant_type: 'client_credentials', ...(scope ? { scope } : {}) }),
    headers: {
      'authorization': `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    method: 'POST',
  });

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
  const privateJwk = await crypto.subtle.exportKey('jwk', privateKey);
  authEnvMock.JWKS_KEY = JSON.stringify({
    keys: [{ ...privateJwk, alg: 'RS256', kid: 'test', use: 'sig' }],
  });

  db = await getTestDB();
  await db.insert(users).values({ id: OWNER_ID }).onConflictDoNothing();
  await db
    .insert(workspaces)
    .values({ id: WORKSPACE_ID, name: 'Ops', primaryOwnerId: OWNER_ID, slug: 'ops-open-platform' })
    .onConflictDoNothing();

  const provider = await createOIDCProvider(db);
  server = createServer(provider.callback());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
});

describe('discovery', () => {
  it('advertises the registration endpoint, client_credentials and the API scopes', async () => {
    const config = (await (
      await fetch(`${origin}/.well-known/openid-configuration`)
    ).json()) as Record<string, any>;

    expect(new URL(config.registration_endpoint).pathname).toBe('/oidc/reg');
    expect(config.grant_types_supported).toContain('client_credentials');
    expect(config.scopes_supported).toEqual(
      expect.arrayContaining(['openid', 'agent:read', 'chat:write', 'model:invoke']),
    );
    expect(config.scopes_supported).not.toContain('*');
  });
});

describe('dynamic client registration', () => {
  it('refuses a registration without an initial access token', async () => {
    const response = await register(machineClient);

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'invalid_token' });
  });

  it('registers a client owned by the token issuer and burns the token', async () => {
    const token = await ownerToken(WORKSPACE_ID);

    const response = await register(machineClient, token);
    expect(response.status).toBe(201);
    const client = (await response.json()) as Record<string, any>;
    expect(client.client_id).toMatch(/^lcd_/);
    expect(client.client_secret).toMatch(/^lcs_/);
    expect(client).not.toHaveProperty('registration_access_token');

    const [row] = await db.select().from(oidcClients).where(eq(oidcClients.id, client.client_id));
    expect(row).toMatchObject({
      enabled: true,
      grants: ['client_credentials'],
      isFirstParty: false,
      name: 'Nightly Sync',
      scopes: ['agent:read', 'chat:read'],
      userId: OWNER_ID,
      workspaceId: WORKSPACE_ID,
    });
    // stored encrypted, never as the plaintext handed back once
    expect(row.clientSecret).not.toBe(client.client_secret);

    expect(
      await db.select().from(oidcAccessTokens).where(eq(oidcAccessTokens.id, token)),
    ).toHaveLength(0);
    const reused = await register(machineClient, token);
    expect(reused.status).toBe(401);
  });

  it('ignores owner metadata a registrant sends itself', async () => {
    const response = await register(
      { ...machineClient, lobehub_owner_user_id: 'someone_else', lobehub_pending_approval: false },
      await ownerToken(),
    );
    const client = (await response.json()) as Record<string, any>;

    const [row] = await db.select().from(oidcClients).where(eq(oidcClients.id, client.client_id));
    expect(row.userId).toBe(OWNER_ID);
    expect(row.workspaceId).toBeNull();
  });

  it('registers a public sign-in client with an https redirect', async () => {
    const response = await register(
      {
        client_name: 'Partner Login',
        grant_types: ['authorization_code', 'refresh_token'],
        redirect_uris: ['https://partner.example.com/callback', 'http://127.0.0.1:8976/cb'],
        response_types: ['code'],
        scope: 'openid profile agent:read',
        token_endpoint_auth_method: 'none',
      },
      await ownerToken(),
    );

    expect(response.status).toBe(201);
  });

  it.each([
    [
      'a plain-http redirect off loopback',
      { redirect_uris: ['http://partner.example.com/cb'] },
      'invalid_redirect_uri',
    ],
    [
      'a wildcard redirect',
      { redirect_uris: ['https://*.example.com/cb'] },
      'invalid_redirect_uri',
    ],
    [
      'a remote key set',
      { jwks_uri: 'https://partner.example.com/jwks' },
      'invalid_client_metadata',
    ],
    [
      'client_credentials on a public client',
      { token_endpoint_auth_method: 'none' },
      'invalid_client_metadata',
    ],
    ['client_credentials without API scopes', { scope: 'openid' }, 'invalid_client_metadata'],
    ['a scope outside the catalog', { scope: 'acceptance:review' }, 'invalid_client_metadata'],
    ['a missing client_name', { client_name: undefined }, 'invalid_client_metadata'],
  ])('rejects %s', async (_label, override, error) => {
    const response = await register({ ...machineClient, ...override }, await ownerToken());

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error });
  });
});

describe('client_credentials', () => {
  const registerMachine = async (workspaceId?: string) =>
    (await (await register(machineClient, await ownerToken(workspaceId))).json()) as {
      client_id: string;
      client_secret: string;
    };

  it('issues a token that acts as the owner and workspace, narrowed to the asked scopes', async () => {
    const { client_id, client_secret } = await registerMachine(WORKSPACE_ID);

    const response = await clientCredentials(client_id, client_secret, 'agent:read');
    expect(response.status).toBe(200);
    const { access_token, scope } = (await response.json()) as Record<string, string>;
    expect(scope).toBe('agent:read');

    const claims = decodeJwt(access_token);
    expect(claims).toMatchObject({
      aud: 'urn:lobehub:chat',
      client_id,
      lobehub_owner: OWNER_ID,
      lobehub_workspace: WORKSPACE_ID,
      scope: 'agent:read',
      sub: client_id,
    });

    const info = await validateOIDCJWT(access_token, { allowClientCredentials: true });
    expect(info.userId).toBe(OWNER_ID);
    expect(info.tokenData).toMatchObject({ clientCredentials: true, workspaceId: WORKSPACE_ID });

    // other transports never accept a machine token
    await expect(validateOIDCJWT(access_token)).rejects.toThrow(/only accepted by the public API/);
  });

  it('grants no capability a personal client did not ask for', async () => {
    const { client_id, client_secret } = await registerMachine();

    const response = await clientCredentials(client_id, client_secret);
    const { access_token } = (await response.json()) as Record<string, string>;
    const claims = decodeJwt(access_token);

    // the public API narrows an unscoped machine token to nothing
    expect(claims).not.toHaveProperty('scope');
    expect(claims).not.toHaveProperty('lobehub_workspace');
    expect(claims.lobehub_owner).toBe(OWNER_ID);
  });

  it('refuses a scope the client did not register', async () => {
    const { client_id, client_secret } = await registerMachine();

    const response = await clientCredentials(client_id, client_secret, 'file:write');

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_scope' });
  });

  it('refuses a wrong secret and a disabled client', async () => {
    const { client_id, client_secret } = await registerMachine();

    expect((await clientCredentials(client_id, 'lcs_wrong')).status).toBe(401);

    await db.update(oidcClients).set({ enabled: false }).where(eq(oidcClients.id, client_id));
    const disabled = await clientCredentials(client_id, client_secret);
    expect(disabled.status).toBe(401);
    expect(await disabled.json()).toMatchObject({ error: 'invalid_client' });
  });
});
