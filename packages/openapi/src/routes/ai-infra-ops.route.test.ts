// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Model bulk / order / reasoning-config and provider check / remote-models /
 * config / order routes, through the real API-key auth, workspace and scope
 * middleware, the real tRPC `aiModel` / `aiProvider` procedures and Drizzle
 * models on PGlite. Only the provider runtime (the network call) is stubbed.
 */
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');

const holder = vi.hoisted(() => ({
  runtime: { chat: vi.fn(), models: vi.fn() },
  serverDB: undefined as unknown,
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: async () => holder.serverDB }));
vi.mock('@/server/modules/AgentRuntime/llmRelay/oneShot', () => ({
  initModelRuntimeForRequest: vi.fn(async () => holder.runtime),
}));

const { getTestDB } = await import('@/database/core/getTestDB');
const { aiModels, aiProviders, apiKeys, users, workspaceMembers, workspaces } =
  await import('@/database/schemas');
const { hashApiKey } = await import('@lobechat/utils/server');
const { and, eq } = await import('drizzle-orm');
const { errorInitFromException, renderApiError } = await import('../common/errors');
const { userAuthMiddleware } = await import('../middleware/auth');
const { workspaceAuthMiddleware } = await import('../middleware/workspace');
const ModelRoutes = (await import('./models.route')).default;
const ProviderRoutes = (await import('./providers.route')).default;
const { BatchModelsResultSchema, ModelReasoningConfigResultSchema, ReorderModelsResultSchema } =
  await import('../types/model-ops.type');
const {
  ProviderCheckResultSchema,
  ProviderConfigResultSchema,
  RemoteModelListSchema,
  ReorderProvidersResultSchema,
} = await import('../types/provider-ops.type');
const { HTTPException } = await import('hono/http-exception');

const serverDB = await getTestDB();
holder.serverDB = serverDB;

const app = new Hono().basePath('/api/v1');
app.use('*', userAuthMiddleware);
app.use('*', workspaceAuthMiddleware);
app.route('/models', ModelRoutes);
app.route('/providers', ProviderRoutes);
app.onError((error, c) =>
  error instanceof HTTPException
    ? renderApiError(c, errorInitFromException(error))
    : renderApiError(c, { message: error.message, status: 500 }),
);

const OWNER = 'r12-infra-owner';
const STRANGER = 'r12-infra-stranger';
const MEMBER = 'r12-infra-member';
const WORKSPACE = 'r12-infra-ws';

/** `sk-lh-` + exactly 16 lowercase alphanumerics. */
const FULL_KEY = 'sk-lh-r12infrafull0001';
const READ_KEY = 'sk-lh-r12infraread0001';
const WRITE_KEY = 'sk-lh-r12infrawrit0001';
const STRANGER_KEY = 'sk-lh-r12infrastrg0001';
const WS_KEY = 'sk-lh-r12infrawsky0001';
const WS_MEMBER_KEY = 'sk-lh-r12infrawsmb0001';

const SECRET = 'sk-upstream-secret-value';

const call = (path: string, key: string | undefined, init: RequestInit = {}) =>
  app.request(`/api/v1${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      ...init.headers,
    },
  });

const send = (method: string, path: string, key: string | undefined, body?: unknown) =>
  call(path, key, { body: body === undefined ? undefined : JSON.stringify(body), method });

const json = async (res: Response) => (await res.json()) as any;

const keyRow = (key: string, userId: string, scopes: string[] | null, workspaceId?: string) => ({
  key,
  keyHash: hashApiKey(key),
  name: key,
  scopes,
  userId,
  ...(workspaceId ? { workspaceId } : {}),
});

beforeEach(async () => {
  holder.runtime.chat.mockReset();
  holder.runtime.models.mockReset();

  await serverDB.delete(aiModels);
  await serverDB.delete(aiProviders);
  await serverDB.delete(apiKeys);
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: OWNER }, { id: STRANGER }, { id: MEMBER }]);
  await serverDB.insert(workspaces).values({
    id: WORKSPACE,
    name: 'R12 infra',
    primaryOwnerId: OWNER,
    slug: 'r12-infra',
  });
  await serverDB.insert(workspaceMembers).values([
    { role: 'owner', userId: OWNER, workspaceId: WORKSPACE },
    { role: 'member', userId: MEMBER, workspaceId: WORKSPACE },
  ]);
  await serverDB
    .insert(apiKeys)
    .values([
      keyRow(FULL_KEY, OWNER, null),
      keyRow(READ_KEY, OWNER, ['model:read']),
      keyRow(WRITE_KEY, OWNER, ['model:read', 'model:write']),
      keyRow(STRANGER_KEY, STRANGER, null),
      keyRow(WS_KEY, OWNER, null, WORKSPACE),
      keyRow(WS_MEMBER_KEY, MEMBER, null, WORKSPACE),
    ]);

  await serverDB.insert(aiProviders).values([
    { id: 'mine', name: 'Mine', settings: { sdkType: 'openai' }, source: 'custom', userId: OWNER },
    {
      id: 'theirs',
      name: 'Theirs',
      settings: { sdkType: 'openai' },
      source: 'custom',
      userId: STRANGER,
    },
    {
      id: 'ws-prov',
      name: 'Workspace provider',
      settings: { sdkType: 'openai' },
      source: 'custom',
      userId: OWNER,
      workspaceId: WORKSPACE,
    },
  ]);
  await serverDB.insert(aiModels).values([
    { id: 'm-1', providerId: 'mine', source: 'custom', type: 'chat', userId: OWNER },
    { id: 'm-2', providerId: 'mine', source: 'custom', type: 'chat', userId: OWNER },
    { id: 'm-x', providerId: 'theirs', source: 'custom', type: 'chat', userId: STRANGER },
  ]);
});

const ownerModel = (id: string, providerId = 'mine') =>
  serverDB.query.aiModels.findFirst({
    where: and(
      eq(aiModels.id, id),
      eq(aiModels.providerId, providerId),
      eq(aiModels.userId, OWNER),
    ),
  });

describe('POST /models/batch', () => {
  it('answers 401 without a key and 403 to a read-only key', async () => {
    const body = { action: 'enable', modelIds: ['m-1'], providerId: 'mine' };
    expect((await send('POST', '/models/batch', undefined, body)).status).toBe(401);

    const res = await send('POST', '/models/batch', READ_KEY, body);
    expect(res.status).toBe(403);
    expect((await json(res)).message).toContain('insufficient_scope');
  });

  it('enables, disables and upserts models', async () => {
    const enabled = await send('POST', '/models/batch', WRITE_KEY, {
      action: 'enable',
      modelIds: ['m-1', 'm-2', 'm-1'],
      providerId: 'mine',
    });
    expect(enabled.status).toBe(200);
    expect(BatchModelsResultSchema.parse((await json(enabled)).data)).toEqual({
      action: 'enable',
      modelIds: ['m-1', 'm-2'],
      providerId: 'mine',
    });
    expect((await ownerModel('m-2'))?.enabled).toBe(true);

    await send('POST', '/models/batch', WRITE_KEY, {
      action: 'disable',
      modelIds: ['m-2'],
      providerId: 'mine',
    });
    expect((await ownerModel('m-2'))?.enabled).toBe(false);

    const upserted = await send('POST', '/models/batch', WRITE_KEY, {
      action: 'upsert',
      models: [{ displayName: 'Remote One', enabled: true, id: 'r-1', source: 'remote' }],
      providerId: 'mine',
    });
    expect(upserted.status).toBe(200);
    const row = await ownerModel('r-1');
    expect(row).toMatchObject({ displayName: 'Remote One', source: 'remote', type: 'chat' });
  });

  it('rejects an invalid body with 400', async () => {
    const unknownAction = await send('POST', '/models/batch', FULL_KEY, {
      action: 'explode',
      modelIds: ['m-1'],
      providerId: 'mine',
    });
    expect(unknownAction.status).toBe(400);

    const empty = await send('POST', '/models/batch', FULL_KEY, {
      action: 'enable',
      modelIds: [],
      providerId: 'mine',
    });
    expect(empty.status).toBe(400);
  });

  it("answers 404 for another user's custom provider and leaves it alone", async () => {
    const res = await send('POST', '/models/batch', FULL_KEY, {
      action: 'disable',
      modelIds: ['m-x'],
      providerId: 'theirs',
    });
    expect(res.status).toBe(404);
    expect(await serverDB.query.aiModels.findMany({ where: eq(aiModels.userId, OWNER) })).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ id: 'm-x' })]),
    );
  });
});

describe('PUT /models/order', () => {
  it('writes the sort order and returns the ids in order', async () => {
    const res = await send('PUT', '/models/order', WRITE_KEY, {
      providerId: 'mine',
      sortMap: [
        { id: 'm-2', sort: 0 },
        { id: 'm-1', sort: 1 },
      ],
    });
    expect(res.status).toBe(200);
    expect(ReorderModelsResultSchema.parse((await json(res)).data)).toEqual({
      modelIds: ['m-2', 'm-1'],
      providerId: 'mine',
    });
    expect((await ownerModel('m-1'))?.sort).toBe(1);
  });

  it('answers 403 to a read-only key and 400 to a missing sort map', async () => {
    const body = { providerId: 'mine', sortMap: [{ id: 'm-1', sort: 0 }] };
    expect((await send('PUT', '/models/order', READ_KEY, body)).status).toBe(403);
    expect((await send('PUT', '/models/order', FULL_KEY, { providerId: 'mine' })).status).toBe(400);
  });
});

describe('DELETE /models/{providerId}/{modelId}', () => {
  it('deletes the caller’s model and 404s afterwards', async () => {
    const res = await send('DELETE', '/models/mine/m-1', WRITE_KEY);
    expect(res.status).toBe(200);
    expect((await json(res)).data).toEqual({ deleted: true, id: 'm-1' });
    expect(await ownerModel('m-1')).toBeUndefined();

    expect((await send('DELETE', '/models/mine/m-1', WRITE_KEY)).status).toBe(404);
  });

  it("answers 404 for another user's model and 403 to a read-only key", async () => {
    expect((await send('DELETE', '/models/theirs/m-x', FULL_KEY)).status).toBe(404);
    expect(
      await serverDB.query.aiModels.findFirst({ where: eq(aiModels.id, 'm-x') }),
    ).toBeDefined();

    expect((await send('DELETE', '/models/mine/m-1', READ_KEY)).status).toBe(403);
  });

  it('needs the workspace admin role inside a workspace', async () => {
    await serverDB.insert(aiModels).values({
      id: 'ws-m',
      providerId: 'ws-prov',
      type: 'chat',
      userId: OWNER,
      workspaceId: WORKSPACE,
    });

    expect((await send('DELETE', '/models/ws-prov/ws-m', WS_MEMBER_KEY)).status).toBe(403);
    expect((await send('DELETE', '/models/ws-prov/ws-m', WS_KEY)).status).toBe(200);
  });
});

describe('/models/{providerId}/{modelId}/reasoning-config', () => {
  it('reads an empty default, merges writes and reads them back', async () => {
    const empty = await call('/models/openai/gpt-5/reasoning-config', READ_KEY);
    expect(empty.status).toBe(200);
    expect(ModelReasoningConfigResultSchema.parse((await json(empty)).data)).toEqual({
      config: {},
      modelId: 'gpt-5',
      providerId: 'openai',
    });

    await send('PUT', '/models/openai/gpt-5/reasoning-config', WRITE_KEY, {
      reasoningEffort: 'high',
    });
    const merged = await send('PUT', '/models/openai/gpt-5/reasoning-config', WRITE_KEY, {
      thinkingLevel: 'low',
    });
    expect(merged.status).toBe(200);
    expect((await json(merged)).data.config).toEqual({
      reasoningEffort: 'high',
      thinkingLevel: 'low',
    });
  });

  it('answers 403 to a read-only key, 400 to an unknown value, 404 to a foreign provider', async () => {
    const path = '/models/openai/gpt-5/reasoning-config';
    expect((await send('PUT', path, READ_KEY, { reasoningEffort: 'high' })).status).toBe(403);
    expect((await send('PUT', path, FULL_KEY, { reasoningEffort: 'ultra' })).status).toBe(400);
    expect((await send('PUT', path, FULL_KEY, { notAField: true })).status).toBe(400);
    expect((await call('/models/theirs/m-x/reasoning-config', FULL_KEY)).status).toBe(404);
  });
});

describe('POST /providers/{id}/check', () => {
  it('needs model:invoke on top of model access', async () => {
    const res = await send('POST', '/providers/mine/check', WRITE_KEY, { model: 'm-1' });
    expect(res.status).toBe(403);
    expect((await json(res)).message).toContain('model:invoke');
    expect(holder.runtime.chat).not.toHaveBeenCalled();
  });

  it('reports a passing and a failing probe', async () => {
    holder.runtime.chat.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const ok = await send('POST', '/providers/mine/check', FULL_KEY, { model: 'm-1' });
    expect(ok.status).toBe(200);
    expect(ProviderCheckResultSchema.parse((await json(ok)).data)).toEqual({
      model: 'm-1',
      ok: true,
    });

    holder.runtime.chat.mockResolvedValueOnce(new Response('bad key', { status: 401 }));
    const failed = await send('POST', '/providers/mine/check', FULL_KEY, { model: 'm-1' });
    expect((await json(failed)).data).toEqual({
      error: 'bad key',
      model: 'm-1',
      ok: false,
      status: 401,
    });
  });

  it("answers 404 for another user's provider without calling it", async () => {
    expect((await send('POST', '/providers/theirs/check', FULL_KEY, {})).status).toBe(404);
    expect(holder.runtime.chat).not.toHaveBeenCalled();
  });
});

describe('GET /providers/{id}/remote-models', () => {
  it('projects the provider model cards', async () => {
    holder.runtime.models.mockResolvedValueOnce([
      { displayName: 'Remote', id: 'r-1', internal: 'drop me', type: 'chat', vision: true },
      { id: 'r-2', type: 'not-a-type' },
      { noId: true },
    ]);

    const res = await call('/providers/mine/remote-models', READ_KEY);
    expect(res.status).toBe(200);
    expect(RemoteModelListSchema.parse((await json(res)).data)).toEqual({
      models: [{ displayName: 'Remote', id: 'r-1', type: 'chat', vision: true }, { id: 'r-2' }],
      providerId: 'mine',
    });
  });

  it('maps a rejected key to 401 instead of an empty 500', async () => {
    holder.runtime.models.mockRejectedValueOnce({
      error: { message: 'Incorrect API key' },
      errorType: 'InvalidProviderAPIKey',
      provider: 'mine',
    });

    const res = await call('/providers/mine/remote-models', READ_KEY);
    expect(res.status).toBe(401);
    expect((await json(res)).message).toContain('Incorrect API key');
  });

  it('keeps providers inside their scope', async () => {
    holder.runtime.models.mockResolvedValue([]);

    expect((await call('/providers/theirs/remote-models', FULL_KEY)).status).toBe(404);
    // A workspace provider is invisible to the personal scope …
    expect((await call('/providers/ws-prov/remote-models', FULL_KEY)).status).toBe(404);
    // … and visible to a key bound to that workspace.
    expect((await call('/providers/ws-prov/remote-models', WS_KEY)).status).toBe(200);
    // A personal key cannot ask for workspace data.
    const mismatch = await call('/providers/ws-prov/remote-models', FULL_KEY, {
      headers: { 'X-Workspace-Id': WORKSPACE },
    });
    expect(mismatch.status).toBe(403);
    expect((await json(mismatch)).code).toBe('workspace_mismatch');
  });
});

describe('PATCH /providers/{id}/config', () => {
  it('stores credentials encrypted, merges them and never returns them', async () => {
    const first = await send('PATCH', '/providers/mine/config', WRITE_KEY, {
      checkModel: 'm-1',
      keyVaults: { apiKey: SECRET },
    });
    expect(first.status).toBe(200);
    const text = await first.text();
    expect(text).not.toContain(SECRET);
    expect(ProviderConfigResultSchema.parse(JSON.parse(text).data)).toEqual({
      checkModel: 'm-1',
      config: {},
      fetchOnClient: null,
      hasKeyVaults: true,
      id: 'mine',
      keyVaultFields: ['apiKey'],
    });

    const second = await send('PATCH', '/providers/mine/config', WRITE_KEY, {
      config: { enableResponseApi: true },
      keyVaults: { baseURL: 'https://proxy.example.com/v1' },
    });
    const data = (await json(second)).data;
    expect(data.keyVaultFields).toEqual(['apiKey', 'baseURL']);
    expect(data.config).toEqual({ enableResponseApi: true });

    const row = await serverDB.query.aiProviders.findFirst({
      where: and(eq(aiProviders.id, 'mine'), eq(aiProviders.userId, OWNER)),
    });
    expect(row?.keyVaults).toBeTruthy();
    expect(row?.keyVaults).not.toContain(SECRET);
  });

  it('answers 403 to a read-only key or a workspace member, 404 to a foreign provider', async () => {
    const body = { keyVaults: { apiKey: SECRET } };
    expect((await send('PATCH', '/providers/mine/config', READ_KEY, body)).status).toBe(403);
    expect((await send('PATCH', '/providers/ws-prov/config', WS_MEMBER_KEY, body)).status).toBe(
      403,
    );
    expect((await send('PATCH', '/providers/theirs/config', FULL_KEY, body)).status).toBe(404);
    expect(
      (await send('PATCH', '/providers/mine/config', FULL_KEY, { config: { other: 1 } })).status,
    ).toBe(400);
  });
});

describe('PUT /providers/order', () => {
  it('orders addressable providers and refuses unknown ones', async () => {
    const res = await send('PUT', '/providers/order', WRITE_KEY, {
      sortMap: [
        { id: 'openai', sort: 1 },
        { id: 'mine', sort: 0 },
      ],
    });
    expect(res.status).toBe(200);
    expect(ReorderProvidersResultSchema.parse((await json(res)).data)).toEqual({
      providerIds: ['mine', 'openai'],
    });
    const mine = await serverDB.query.aiProviders.findFirst({
      where: and(eq(aiProviders.id, 'mine'), eq(aiProviders.userId, OWNER)),
    });
    expect(mine?.sort).toBe(0);

    const foreign = await send('PUT', '/providers/order', WRITE_KEY, {
      sortMap: [{ id: 'theirs', sort: 0 }],
    });
    expect(foreign.status).toBe(404);
    expect((await send('PUT', '/providers/order', READ_KEY, { sortMap: [] })).status).toBe(403);
  });
});
