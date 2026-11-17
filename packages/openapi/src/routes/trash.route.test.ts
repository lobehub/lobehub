// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/api/v1/trash` over real HTTP: real auth / workspace middlewares, scope
 * gates, controller, REST service, the shared `trash` procedures and the real
 * `TrashService`, on PGlite. API keys are real `api_keys` rows.
 */
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');

const holder = vi.hoisted(() => ({ serverDB: undefined as unknown }));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => holder.serverDB,
}));

const { getTestDB } = await import('@/database/core/getTestDB');
const { eq } = await import('drizzle-orm');
const { apiKeys, topics, trashItems, users, workspaceMembers, workspaces } =
  await import('@/database/schemas');
const { hashApiKey } = await import('@lobechat/utils/server');
const { HTTPException } = await import('hono/http-exception');
const { TrashService } = await import('@/server/services/trash');
const { errorInitFromException, renderApiError } = await import('../common/errors');
const { userAuthMiddleware } = await import('../middleware/auth');
const { workspaceAuthMiddleware } = await import('../middleware/workspace');
const {
  EmptyTrashResultSchema,
  TrashCountsSchema,
  TrashListSchema,
  TrashPurgeResultSchema,
  TrashRestoreResultSchema,
} = await import('../types/trash.type');
const TrashRoutes = (await import('./trash.route')).default;

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
app.route('/trash', TrashRoutes);

const OWNER = 'r12-trash-owner';
const MEMBER = 'r12-trash-member';
const STRANGER = 'r12-trash-stranger';
const WORKSPACE = 'ws_r12_trash';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

// `sk-lh-` + exactly 16 lowercase alphanumerics.
const KEYS = {
  chatOnly: 'sk-lh-r12trchatonly001',
  memberWs: 'sk-lh-r12trmemberws001',
  ownerRead: 'sk-lh-r12trownerread01',
  ownerWrite: 'sk-lh-r12trownerwrite1',
  ownerWs: 'sk-lh-r12trownerws0001',
  stranger: 'sk-lh-r12trstranger001',
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

/** Move topics to the bin the way the app does, and return their trash item ids. */
const trashTopics = async (userId: string, ids: string[], workspaceId?: string) => {
  await new TrashService(serverDB, userId, workspaceId).trashTopics(ids);
  const rows = await serverDB.select().from(trashItems);
  return ids.map((id) => rows.find((row) => row.resourceId === id)!.id);
};

const topicRow = (id: string) => serverDB.query.topics.findFirst({ where: eq(topics.id, id) });

beforeEach(async () => {
  await serverDB.delete(trashItems);
  await serverDB.delete(topics);
  await serverDB.delete(apiKeys);
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: OWNER }, { id: MEMBER }, { id: STRANGER }]);
  await serverDB
    .insert(workspaces)
    .values({ id: WORKSPACE, name: 'R12', primaryOwnerId: OWNER, slug: 'r12-trash' });
  await serverDB.insert(workspaceMembers).values([
    { role: 'owner', userId: OWNER, workspaceId: WORKSPACE },
    { role: 'member', userId: MEMBER, workspaceId: WORKSPACE },
  ]);
  await serverDB.insert(topics).values([
    { id: 'tpc_r12_a', title: 'Alpha', userId: OWNER },
    { id: 'tpc_r12_b', title: 'Beta', userId: OWNER },
    { id: 'tpc_r12_s', title: 'Stranger', userId: STRANGER },
    { id: 'tpc_r12_ws', title: 'Team', userId: MEMBER, workspaceId: WORKSPACE },
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
      key(KEYS.ownerWrite, OWNER, ['trash:write']),
      key(KEYS.ownerRead, OWNER, ['trash:read']),
      key(KEYS.chatOnly, OWNER, ['chat:write']),
      key(KEYS.stranger, STRANGER, ['trash:write']),
      key(KEYS.ownerWs, OWNER, ['trash:write'], WORKSPACE),
      key(KEYS.memberWs, MEMBER, ['trash:write'], WORKSPACE),
    ]);
});

describe('authentication and API-key scopes', () => {
  it('answers 401 without credentials', async () => {
    expect((await call('/trash')).status).toBe(401);
  });

  it('refuses a key without a trash scope', async () => {
    const res = await call('/trash', { key: KEYS.chatOnly });

    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('insufficient_scope');
  });

  it('lets a trash:read key list and count but not restore or purge', async () => {
    const [id] = await trashTopics(OWNER, ['tpc_r12_a']);

    expect((await call('/trash', { key: KEYS.ownerRead })).status).toBe(200);
    expect((await call('/trash/counts', { key: KEYS.ownerRead })).status).toBe(200);
    for (const action of ['restore', 'purge']) {
      const res = await call(`/trash/${action}`, {
        body: { ids: [id] },
        key: KEYS.ownerRead,
        method: 'POST',
      });
      expect(res.status).toBe(403);
    }
    expect(
      (await call('/trash/empty', { body: {}, key: KEYS.ownerRead, method: 'POST' })).status,
    ).toBe(403);
  });
});

describe('request validation', () => {
  it('requires at least one id', async () => {
    const res = await call('/trash/restore', {
      body: { ids: [] },
      key: KEYS.ownerWrite,
      method: 'POST',
    });

    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe('validation_error');
  });

  it('requires trash item ids to be UUIDs', async () => {
    const res = await call('/trash/purge', {
      body: { ids: ['tpc_r12_a'] },
      key: KEYS.ownerWrite,
      method: 'POST',
    });

    expect(res.status).toBe(400);
  });

  it('refuses an unknown resource type', async () => {
    expect((await call('/trash?resourceType=planet', { key: KEYS.ownerRead })).status).toBe(400);
  });

  it('answers 404 for a project filter the caller cannot read', async () => {
    expect((await call('/trash?projectId=proj_missing', { key: KEYS.ownerRead })).status).toBe(404);
  });
});

describe('list, counts, restore and purge', () => {
  it('lists the bin with cursor pagination and counts it by type', async () => {
    await trashTopics(OWNER, ['tpc_r12_a', 'tpc_r12_b']);

    const first = TrashListSchema.parse(
      (await json(await call('/trash?limit=1', { key: KEYS.ownerRead }))).data,
    );
    expect(first.items).toHaveLength(1);
    expect(first.hasMore).toBe(true);
    expect(first.items[0]).toMatchObject({ resourceType: 'topic' });

    const second = TrashListSchema.parse(
      (
        await json(
          await call(`/trash?limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`, {
            key: KEYS.ownerRead,
          }),
        )
      ).data,
    );
    expect(second.items).toHaveLength(1);
    expect(second.items[0].id).not.toBe(first.items[0].id);

    const counts = TrashCountsSchema.parse(
      (await json(await call('/trash/counts', { key: KEYS.ownerRead }))).data,
    );
    expect(counts.byType.topic).toBe(2);
    expect(counts.byType.agent).toBe(0);
    expect(counts.total).toBe(2);
  });

  it('restores a topic back to life', async () => {
    const [id] = await trashTopics(OWNER, ['tpc_r12_a']);
    expect((await topicRow('tpc_r12_a'))?.deletedAt).toBeTruthy();

    const res = await call('/trash/restore', {
      body: { ids: [id, MISSING_ID] },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    const result = TrashRestoreResultSchema.parse((await json(res)).data);

    expect(result.restored.map((item) => item.resourceId)).toEqual(['tpc_r12_a']);
    expect(result.failed).toEqual([{ code: 'notFound', id: MISSING_ID }]);
    expect((await topicRow('tpc_r12_a'))?.deletedAt).toBeNull();
    expect(await serverDB.select().from(trashItems)).toHaveLength(0);
  });

  it('purges a topic permanently', async () => {
    const [id] = await trashTopics(OWNER, ['tpc_r12_a']);

    const res = await call('/trash/purge', {
      body: { ids: [id] },
      key: KEYS.ownerWrite,
      method: 'POST',
    });

    expect(TrashPurgeResultSchema.parse((await json(res)).data)).toEqual({
      blocked: [],
      purged: 1,
    });
    expect(await topicRow('tpc_r12_a')).toBeUndefined();
  });

  it('empties the bin', async () => {
    await trashTopics(OWNER, ['tpc_r12_a', 'tpc_r12_b']);

    const res = await call('/trash/empty', { body: {}, key: KEYS.ownerWrite, method: 'POST' });

    expect(EmptyTrashResultSchema.parse((await json(res)).data)).toEqual({
      blocked: 0,
      hasMore: false,
      purged: 2,
    });
    expect(await topicRow('tpc_r12_a')).toBeUndefined();
    expect(await topicRow('tpc_r12_b')).toBeUndefined();
  });
});

describe('ownership', () => {
  it("never lists, restores or purges another user's deletions", async () => {
    const [id] = await trashTopics(STRANGER, ['tpc_r12_s']);

    const list = (await json(await call('/trash', { key: KEYS.ownerWrite }))).data;
    expect(list.items).toEqual([]);

    const restore = (
      await json(
        await call('/trash/restore', { body: { ids: [id] }, key: KEYS.ownerWrite, method: 'POST' }),
      )
    ).data;
    expect(restore).toEqual({ failed: [{ code: 'notFound', id }], restored: [] });

    const purge = (
      await json(
        await call('/trash/purge', { body: { ids: [id] }, key: KEYS.ownerWrite, method: 'POST' }),
      )
    ).data;
    expect(purge).toEqual({ blocked: [], purged: 0 });

    await call('/trash/empty', { body: {}, key: KEYS.ownerWrite, method: 'POST' });

    expect((await topicRow('tpc_r12_s'))?.deletedAt).toBeTruthy();
    expect(await serverDB.select().from(trashItems)).toHaveLength(1);
  });

  it('keeps the workspace bin apart from the personal one', async () => {
    await trashTopics(MEMBER, ['tpc_r12_ws'], WORKSPACE);

    const personal = (await json(await call('/trash', { key: KEYS.ownerRead }))).data;
    expect(personal.items).toEqual([]);

    const team = (
      await json(
        await call('/trash?visibility=public', { key: KEYS.ownerWs, workspaceId: WORKSPACE }),
      )
    ).data;
    expect(team.items.map((item: { resourceId: string }) => item.resourceId)).toEqual([
      'tpc_r12_ws',
    ]);
  });

  it("lets only owners and admins manage another member's public deletion", async () => {
    const [id] = await trashTopics(MEMBER, ['tpc_r12_ws'], WORKSPACE);
    await serverDB.insert(topics).values({
      id: 'tpc_r12_ws_owner',
      title: 'Owner team topic',
      userId: OWNER,
      workspaceId: WORKSPACE,
    });
    const [ownerItem] = await trashTopics(OWNER, ['tpc_r12_ws_owner'], WORKSPACE);

    // A plain member cannot touch the owner's deletion or empty the public side.
    const memberRestore = await call('/trash/restore', {
      body: { ids: [ownerItem] },
      key: KEYS.memberWs,
      method: 'POST',
      workspaceId: WORKSPACE,
    });
    expect(memberRestore.status).toBe(403);
    const memberEmpty = await call('/trash/empty', {
      body: { visibility: 'public' },
      key: KEYS.memberWs,
      method: 'POST',
      workspaceId: WORKSPACE,
    });
    expect(memberEmpty.status).toBe(403);
    expect((await topicRow('tpc_r12_ws_owner'))?.deletedAt).toBeTruthy();

    // The owner may restore the member's public deletion.
    const ownerRestore = await call('/trash/restore', {
      body: { ids: [id] },
      key: KEYS.ownerWs,
      method: 'POST',
      workspaceId: WORKSPACE,
    });
    expect(ownerRestore.status).toBe(200);
    expect((await json(ownerRestore)).data.restored).toHaveLength(1);
    expect((await topicRow('tpc_r12_ws'))?.deletedAt).toBeNull();
  });
});
