// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/api/v1/plugins` writes over real HTTP: the real routes behind the `app.ts`
 * auth and workspace middlewares, the real permission/scope gates, controller,
 * REST service and the shared `plugin` procedures, on PGlite. API keys are
 * real `api_keys` rows; only the database handle is pointed at PGlite.
 */
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');

const holder = vi.hoisted(() => ({ serverDB: undefined as unknown }));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => holder.serverDB,
}));
const { getTestDB } = await import('@/database/core/getTestDB');
const { apiKeys, userInstalledPlugins, users, workspaceMembers, workspaces } =
  await import('@/database/schemas');
const { hashApiKey } = await import('@lobechat/utils/server');
const { HTTPException } = await import('hono/http-exception');
const { errorInitFromException, renderApiError } = await import('../common/errors');
const { userAuthMiddleware } = await import('../middleware/auth');
const { workspaceAuthMiddleware } = await import('../middleware/workspace');
const { InstalledPluginSchema } = await import('../types/plugin.type');
const { PluginsRoutes } = await import('./plugins.route');

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
app.route('/plugins', PluginsRoutes);

const OWNER = 'r7-plugins-owner';
const STRANGER = 'r7-plugins-stranger';
const WORKSPACE = 'r7-plugins-ws';

const KEYS = {
  chatOnly: 'sk-lh-r7plugchatonly01',
  ownerRead: 'sk-lh-r7plugownerread1',
  ownerWrite: 'sk-lh-r7plugownerwrit1',
  stranger: 'sk-lh-r7plugstranger01',
  workspace: 'sk-lh-r7plugworkspace1',
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

const manifest = (identifier: string, version = '1.0.0') => ({
  api: [{ description: 'Look up the weather', name: 'getWeather', parameters: {} }],
  identifier,
  meta: { title: 'Weather' },
  version,
});

const install = (identifier = 'weather', key: string = KEYS.ownerWrite) =>
  call('/plugins', {
    body: { identifier, manifest: manifest(identifier), type: 'plugin' },
    key,
    method: 'POST',
  });

beforeEach(async () => {
  await serverDB.delete(userInstalledPlugins);
  await serverDB.delete(apiKeys);
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: OWNER }, { id: STRANGER }]);
  await serverDB
    .insert(workspaces)
    .values([{ id: WORKSPACE, name: 'R7 plugins', primaryOwnerId: OWNER, slug: 'r7-plugins' }]);
  await serverDB
    .insert(workspaceMembers)
    .values([{ role: 'owner', userId: OWNER, workspaceId: WORKSPACE }]);
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
      key(KEYS.ownerWrite, OWNER, ['agent:write']),
      key(KEYS.ownerRead, OWNER, ['agent:read']),
      key(KEYS.chatOnly, OWNER, ['chat:write']),
      key(KEYS.stranger, STRANGER, ['agent:write']),
      key(KEYS.workspace, OWNER, ['agent:write'], WORKSPACE),
    ]);
});

describe('authentication and API-key scopes', () => {
  it('answers 401 without credentials', async () => {
    expect((await install('weather', '')).status).toBe(401);
  });

  it('refuses a key without agent:write, and an agent:read key', async () => {
    for (const key of [KEYS.chatOnly, KEYS.ownerRead]) {
      const res = await install('weather', key);
      expect(res.status).toBe(403);
      expect((await json(res)).code).toBe('insufficient_scope');
    }
    expect(await serverDB.select().from(userInstalledPlugins)).toHaveLength(0);
  });
});

describe('request validation', () => {
  it('rejects a manifest whose identifier differs, and an unknown type', async () => {
    const mismatch = await call('/plugins', {
      body: { identifier: 'weather', manifest: manifest('other'), type: 'plugin' },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(mismatch.status).toBe(400);
    expect((await json(mismatch)).code).toBe('validation_error');

    const badType = await call('/plugins', {
      body: { identifier: 'weather', manifest: manifest('weather'), type: 'mcp' },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(badType.status).toBe(400);
  });

  it('rejects an empty update', async () => {
    await install();
    const res = await call('/plugins/weather', { body: {}, key: KEYS.ownerWrite, method: 'PATCH' });
    expect(res.status).toBe(400);
  });
});

describe('install, update, uninstall', () => {
  it('installs, lists, reinstalls, updates settings and uninstalls a plugin', async () => {
    const res = await install();
    expect(res.status).toBe(200);
    const installed = (await json(res)).data;
    expect(() => InstalledPluginSchema.parse(installed)).not.toThrow();
    expect(installed).toMatchObject({ identifier: 'weather', type: 'plugin' });

    const list = (await json(await call('/plugins', { key: KEYS.ownerRead }))).data;
    expect(list.plugins.map((p: any) => p.identifier)).toEqual(['weather']);

    // Installing again replaces the manifest instead of failing
    const again = await call('/plugins', {
      body: { identifier: 'weather', manifest: manifest('weather', '2.0.0'), type: 'plugin' },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(again.status).toBe(200);
    const [row] = await serverDB.select().from(userInstalledPlugins);
    expect((row.manifest as any).version).toBe('2.0.0');

    const updated = await call('/plugins/weather', {
      body: { settings: { unit: 'celsius' } },
      key: KEYS.ownerWrite,
      method: 'PATCH',
    });
    expect(updated.status).toBe(200);
    const [after] = await serverDB.select().from(userInstalledPlugins);
    expect(after.settings).toEqual({ unit: 'celsius' });

    const removed = await call('/plugins/weather', { key: KEYS.ownerWrite, method: 'DELETE' });
    expect((await json(removed)).data).toEqual({ deleted: true, id: 'weather' });
    expect(await serverDB.select().from(userInstalledPlugins)).toHaveLength(0);
  });

  it('answers 404 for a plugin that is not installed', async () => {
    const update = await call('/plugins/missing', {
      body: { settings: {} },
      key: KEYS.ownerWrite,
      method: 'PATCH',
    });
    const remove = await call('/plugins/missing', { key: KEYS.ownerWrite, method: 'DELETE' });
    expect(update.status).toBe(404);
    expect(remove.status).toBe(404);
  });
});

describe('ownership and workspace isolation', () => {
  it("cannot update or uninstall another user's plugin", async () => {
    await install();

    const update = await call('/plugins/weather', {
      body: { settings: { hijacked: true } },
      key: KEYS.stranger,
      method: 'PATCH',
    });
    const remove = await call('/plugins/weather', { key: KEYS.stranger, method: 'DELETE' });
    expect(update.status).toBe(404);
    expect(remove.status).toBe(404);
    expect(await serverDB.select().from(userInstalledPlugins)).toHaveLength(1);
  });

  it('keeps personal and workspace installs apart', async () => {
    await install('weather');
    await install('search', KEYS.workspace);

    const personal = (await json(await call('/plugins', { key: KEYS.ownerWrite }))).data;
    const shared = (await json(await call('/plugins', { key: KEYS.workspace }))).data;
    expect(personal.plugins.map((p: any) => p.identifier)).toEqual(['weather']);
    expect(shared.plugins.map((p: any) => p.identifier)).toEqual(['search']);

    expect((await call('/plugins/weather', { key: KEYS.workspace, method: 'DELETE' })).status).toBe(
      404,
    );
  });

  it('refuses a workspace header the key does not belong to', async () => {
    const res = await call('/plugins', {
      body: { identifier: 'weather', manifest: manifest('weather'), type: 'plugin' },
      key: KEYS.stranger,
      method: 'POST',
      workspaceId: WORKSPACE,
    });
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('workspace_mismatch');
  });
});
