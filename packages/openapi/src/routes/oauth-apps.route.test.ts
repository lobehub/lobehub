// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/api/v1/oauth-apps` over real HTTP: real auth / workspace middlewares,
 * scope and workspace-role gates, controller, REST service and the shared
 * `oauthApp` procedures, on PGlite. API keys are real `api_keys` rows.
 */
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');

const holder = vi.hoisted(() => ({ serverDB: undefined as unknown }));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => holder.serverDB,
}));

const { getTestDB } = await import('@/database/core/getTestDB');
const { apiKeys, oidcClients, users, workspaceMembers, workspaces } =
  await import('@/database/schemas');
const { hashApiKey } = await import('@lobechat/utils/server');
const { HTTPException } = await import('hono/http-exception');
const { errorInitFromException, renderApiError } = await import('../common/errors');
const { userAuthMiddleware } = await import('../middleware/auth');
const { workspaceAuthMiddleware } = await import('../middleware/workspace');
const { CreatedOAuthAppSchema, OAuthAppListSchema, OAuthAppSchema, OAuthAppSecretSchema } =
  await import('../types/oauth-app.type');
const { DeletedResourceSchema } = await import('../types/common.type');
const OAuthAppsRoutes = (await import('./oauth-apps.route')).default;

const serverDB = await getTestDB();
holder.serverDB = serverDB;

const app = new Hono().basePath('/api/v1');
app.onError((error, c) =>
  error instanceof HTTPException
    ? renderApiError(c, errorInitFromException(error))
    : renderApiError(c, { message: error.message, status: 500 }),
);
app.use('*', userAuthMiddleware);
app.use('*', workspaceAuthMiddleware);
app.route('/oauth-apps', OAuthAppsRoutes);

const OWNER = 'r12-oauth-owner';
const MEMBER = 'r12-oauth-member';
const STRANGER = 'r12-oauth-stranger';
const WORKSPACE = 'ws_r12_oauth';
const OTHER_WORKSPACE = 'ws_r12_oauth_other';

// `sk-lh-` + exactly 16 lowercase alphanumerics.
const KEYS = {
  chatOnly: 'sk-lh-r12oachatonly001',
  memberWs: 'sk-lh-r12oamemberws001',
  ownerRead: 'sk-lh-r12oaownerread01',
  ownerWrite: 'sk-lh-r12oaownerwrite1',
  ownerWs: 'sk-lh-r12oaownerws0001',
  stranger: 'sk-lh-r12oastranger001',
  strangerWs: 'sk-lh-r12oastrangerws1',
} as const;

const call = (
  path: string,
  init: { body?: unknown; key?: string; method?: string; workspaceId?: string } = {},
) =>
  app.request(`/api/v1${path}`, {
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    headers: {
      ...(init.key ? { authorization: `Bearer ${init.key}` } : {}),
      ...(init.workspaceId ? { 'x-workspace-id': init.workspaceId } : {}),
      'content-type': 'application/json',
    },
    method: init.method ?? 'GET',
  });

const json = async (res: Response) => (await res.json()) as any;

const createApp = async (
  body: Record<string, unknown> = {},
  key: string = KEYS.ownerWrite,
  workspaceId?: string,
) =>
  call('/oauth-apps', {
    body: {
      name: 'Deploy bot',
      redirectUris: ['https://example.com/callback'],
      type: 'web',
      ...body,
    },
    key,
    method: 'POST',
    workspaceId,
  });

beforeEach(async () => {
  await serverDB.delete(oidcClients);
  await serverDB.delete(apiKeys);
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: OWNER }, { id: MEMBER }, { id: STRANGER }]);
  await serverDB.insert(workspaces).values([
    { id: WORKSPACE, name: 'R12', primaryOwnerId: OWNER, slug: 'r12-oauth' },
    { id: OTHER_WORKSPACE, name: 'Other', primaryOwnerId: STRANGER, slug: 'r12-oauth-other' },
  ]);
  await serverDB.insert(workspaceMembers).values([
    { role: 'owner', userId: OWNER, workspaceId: WORKSPACE },
    { role: 'member', userId: MEMBER, workspaceId: WORKSPACE },
    { role: 'owner', userId: STRANGER, workspaceId: OTHER_WORKSPACE },
  ]);

  const key = (value: string, userId: string, scopes: string[], workspaceId?: string) => ({
    key: value,
    keyHash: hashApiKey(value),
    name: value,
    scopes,
    userId,
    workspaceId: workspaceId ?? null,
  });
  await serverDB
    .insert(apiKeys)
    .values([
      key(KEYS.ownerWrite, OWNER, ['oauth_app:write']),
      key(KEYS.ownerRead, OWNER, ['oauth_app:read']),
      key(KEYS.chatOnly, OWNER, ['chat:write']),
      key(KEYS.stranger, STRANGER, ['oauth_app:write']),
      key(KEYS.ownerWs, OWNER, ['oauth_app:write'], WORKSPACE),
      key(KEYS.memberWs, MEMBER, ['oauth_app:write'], WORKSPACE),
      key(KEYS.strangerWs, STRANGER, ['oauth_app:write'], OTHER_WORKSPACE),
    ]);
});

describe('authentication and API-key scopes', () => {
  it('answers 401 without credentials', async () => {
    expect((await call('/oauth-apps')).status).toBe(401);
  });

  it('refuses a key without an oauth_app scope', async () => {
    const res = await call('/oauth-apps', { key: KEYS.chatOnly });

    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('insufficient_scope');
  });

  it('lets an oauth_app:read key list but not create', async () => {
    expect((await call('/oauth-apps', { key: KEYS.ownerRead })).status).toBe(200);

    const res = await createApp({}, KEYS.ownerRead);
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('insufficient_scope');
  });
});

describe('request validation', () => {
  it('requires a name', async () => {
    const res = await createApp({ name: '' });

    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe('validation_error');
  });

  it('refuses an insecure redirect URI with the shared rule', async () => {
    const res = await createApp({ redirectUris: ['http://example.com/callback'] });
    const body = await json(res);

    expect(res.status).toBe(400);
    expect(body.code).toBe('validation_error');
    expect(body.message).toContain('redirectUri.insecure');
    expect(await serverDB.select().from(oidcClients)).toHaveLength(0);
  });

  it('refuses an empty update', async () => {
    const created = (await json(await createApp())).data;
    const res = await call(`/oauth-apps/${created.id}`, {
      body: {},
      key: KEYS.ownerWrite,
      method: 'PATCH',
    });

    expect(res.status).toBe(400);
  });
});

describe('lifecycle', () => {
  it('returns a web app secret once, never on reads', async () => {
    const res = await createApp();
    expect(res.status).toBe(201);

    const created = CreatedOAuthAppSchema.parse((await json(res)).data);
    expect(created.clientSecret).toMatch(/^lcs_/);
    expect(created).toMatchObject({ enabled: true, hasSecret: true, type: 'web' });

    // The stored secret is encrypted, not the plaintext handed back.
    const [row] = await serverDB.select().from(oidcClients);
    expect(row.clientSecret).toBeTruthy();
    expect(row.clientSecret).not.toBe(created.clientSecret);

    const got = await json(await call(`/oauth-apps/${created.id}`, { key: KEYS.ownerRead }));
    expect(OAuthAppSchema.parse(got.data)).toMatchObject({ hasSecret: true, id: created.id });
    expect(got.data.clientSecret).toBeUndefined();

    const list = OAuthAppListSchema.parse(
      (await json(await call('/oauth-apps', { key: KEYS.ownerRead }))).data,
    );
    expect(list).toMatchObject({ hasMore: false, nextCursor: null, total: 1 });
    expect(list.items.map((item) => item.id)).toEqual([created.id]);
  });

  it('creates a device app as a public client without a secret', async () => {
    const created = (await json(await createApp({ redirectUris: undefined, type: 'device' }))).data;

    expect(created).toMatchObject({
      clientSecret: null,
      hasSecret: false,
      tokenEndpointAuthMethod: 'none',
      type: 'device',
    });

    const rotate = await call(`/oauth-apps/${created.id}/rotate-secret`, {
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(rotate.status).toBe(409);
  });

  it('edits, disables, rotates and deletes an app', async () => {
    const created = (await json(await createApp({ issueSecret: false }))).data;
    expect(created).toMatchObject({ clientSecret: null, hasSecret: false });

    const patched = await call(`/oauth-apps/${created.id}`, {
      body: { enabled: false, logoUri: 'https://example.com/logo.png', name: 'Renamed' },
      key: KEYS.ownerWrite,
      method: 'PATCH',
    });
    expect(patched.status).toBe(200);
    expect(OAuthAppSchema.parse((await json(patched)).data)).toMatchObject({
      enabled: false,
      logoUri: 'https://example.com/logo.png',
      name: 'Renamed',
    });

    const first = await call(`/oauth-apps/${created.id}/rotate-secret`, {
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(first.status).toBe(200);
    const firstSecret = OAuthAppSecretSchema.parse((await json(first)).data).clientSecret;
    const second = (
      await json(
        await call(`/oauth-apps/${created.id}/rotate-secret`, {
          key: KEYS.ownerWrite,
          method: 'POST',
        }),
      )
    ).data.clientSecret;
    expect(second).not.toBe(firstSecret);

    const deleted = await call(`/oauth-apps/${created.id}`, {
      key: KEYS.ownerWrite,
      method: 'DELETE',
    });
    expect(DeletedResourceSchema.parse((await json(deleted)).data)).toEqual({
      deleted: true,
      id: created.id,
    });
    expect((await call(`/oauth-apps/${created.id}`, { key: KEYS.ownerRead })).status).toBe(404);
  });
});

describe('ownership', () => {
  it("answers 404 for another user's app on every path", async () => {
    const { id } = (await json(await createApp())).data;

    const attempts = [
      call(`/oauth-apps/${id}`, { key: KEYS.stranger }),
      call(`/oauth-apps/${id}`, { body: { name: 'x' }, key: KEYS.stranger, method: 'PATCH' }),
      call(`/oauth-apps/${id}/rotate-secret`, { key: KEYS.stranger, method: 'POST' }),
      call(`/oauth-apps/${id}`, { key: KEYS.stranger, method: 'DELETE' }),
    ];
    for (const res of await Promise.all(attempts)) expect(res.status).toBe(404);

    const list = (await json(await call('/oauth-apps', { key: KEYS.stranger }))).data;
    expect(list.items).toEqual([]);

    const [row] = await serverDB.select().from(oidcClients);
    expect(row.name).toBe('Deploy bot');
  });

  it('keeps workspace apps inside their workspace', async () => {
    const res = await createApp({}, KEYS.ownerWs, WORKSPACE);
    expect(res.status).toBe(201);
    const { id, workspaceId } = (await json(res)).data;
    expect(workspaceId).toBe(WORKSPACE);

    // Not a personal app of the creator, and not visible from another workspace.
    expect((await call(`/oauth-apps/${id}`, { key: KEYS.ownerRead })).status).toBe(404);
    expect(
      (await call(`/oauth-apps/${id}`, { key: KEYS.strangerWs, workspaceId: OTHER_WORKSPACE }))
        .status,
    ).toBe(404);

    // A workspace key cannot be pointed at a different workspace.
    expect(
      (await call('/oauth-apps', { key: KEYS.ownerWs, workspaceId: OTHER_WORKSPACE })).status,
    ).toBe(403);
  });

  it('lets a workspace member read but only owners and admins write', async () => {
    const { id } = (await json(await createApp({}, KEYS.ownerWs, WORKSPACE))).data;

    const list = await call('/oauth-apps', { key: KEYS.memberWs, workspaceId: WORKSPACE });
    expect(list.status).toBe(200);
    expect((await json(list)).data.items.map((item: { id: string }) => item.id)).toEqual([id]);

    const writes = [
      createApp({}, KEYS.memberWs, WORKSPACE),
      call(`/oauth-apps/${id}`, {
        body: { enabled: false },
        key: KEYS.memberWs,
        method: 'PATCH',
        workspaceId: WORKSPACE,
      }),
      call(`/oauth-apps/${id}/rotate-secret`, {
        key: KEYS.memberWs,
        method: 'POST',
        workspaceId: WORKSPACE,
      }),
      call(`/oauth-apps/${id}`, { key: KEYS.memberWs, method: 'DELETE', workspaceId: WORKSPACE }),
    ];
    for (const res of await Promise.all(writes)) expect(res.status).toBe(403);

    const rows = await serverDB.select().from(oidcClients);
    expect(rows).toHaveLength(1);
    expect(rows[0].enabled).toBe(true);
  });
});
