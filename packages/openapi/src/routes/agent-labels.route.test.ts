// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/api/v1/agent-labels` over real HTTP on PGlite: real auth, workspace and
 * scope middlewares, controller, REST service and the shared `agentLabel`
 * procedures. API keys are real `api_keys` rows.
 */
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');

const holder = vi.hoisted(() => ({ serverDB: undefined as unknown }));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => holder.serverDB,
}));

const { getTestDB } = await import('@/database/core/getTestDB');
const { apiKeys, users } = await import('@/database/schemas');
const { buildRouteApp, json, seedUsersAndKeys } = await import('./__tests__/pglite-harness');
const { AgentLabelListSchema, AgentLabelSchema } = await import('../types/agent-label.type');
const AgentLabelRoutes = (await import('./agent-labels.route')).default;

const serverDB = await getTestDB();
holder.serverDB = serverDB;

const { call } = buildRouteApp({ 'agent-labels': AgentLabelRoutes });

const OWNER = 'r8-label-owner';
const STRANGER = 'r8-label-stranger';

const KEYS = {
  chatOnly: 'sk-lh-r8labelchatonly1',
  ownerRead: 'sk-lh-r8labelownerread',
  ownerWrite: 'sk-lh-r8labelownerwrit',
  stranger: 'sk-lh-r8labelstranger1',
} as const;

const create = (body: Record<string, unknown>, key: string = KEYS.ownerWrite) =>
  call('/agent-labels', { body, key, method: 'POST' });

beforeEach(async () => {
  await serverDB.delete(apiKeys);
  await serverDB.delete(users);
  await seedUsersAndKeys(
    serverDB,
    [OWNER, STRANGER],
    [
      [KEYS.ownerWrite, OWNER, ['agent:write']],
      [KEYS.ownerRead, OWNER, ['agent:read']],
      [KEYS.chatOnly, OWNER, ['chat:write']],
      [KEYS.stranger, STRANGER, null],
    ],
  );
});

describe('authentication, API-key scopes and workspace header', () => {
  it('answers 401 without credentials', async () => {
    expect((await call('/agent-labels')).status).toBe(401);
    expect((await call('/agent-labels', { body: { name: 'x' }, method: 'POST' })).status).toBe(401);
  });

  it('refuses a key without an agent scope, and agent:read writing', async () => {
    const res = await call('/agent-labels', { key: KEYS.chatOnly });
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('insufficient_scope');

    expect((await call('/agent-labels', { key: KEYS.ownerRead })).status).toBe(200);
    expect((await create({ name: 'Nope' }, KEYS.ownerRead)).status).toBe(403);
  });

  it('rejects an X-Workspace-Id the personal key does not belong to', async () => {
    const res = await call('/agent-labels', {
      headers: { 'X-Workspace-Id': 'ws_other' },
      key: KEYS.ownerRead,
    });
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('workspace_mismatch');
  });
});

describe('request validation', () => {
  it('rejects an empty name, a non-hex colour and unknown fields', async () => {
    const empty = await create({ name: '   ' });
    expect(empty.status).toBe(400);
    expect(JSON.stringify(await json(empty))).toContain('Label name cannot be empty');

    const color = await create({ color: 'url(https://evil.example)', name: 'Bad' });
    expect(color.status).toBe(400);
    expect(JSON.stringify(await json(color))).toContain('hex literal');

    expect((await create({ name: 'X', userId: STRANGER })).status).toBe(400);
  });

  it('rejects a malformed cursor', async () => {
    const res = await call('/agent-labels?limit=0', { key: KEYS.ownerRead });
    expect(res.status).toBe(400);
  });
});

describe('label registry CRUD', () => {
  it('creates, lists, reads, updates and deletes a label', async () => {
    const created = await create({ color: '#1677ff', description: 'Team work', name: 'Work' });
    expect(created.status).toBe(201);
    const label = AgentLabelSchema.parse((await json(created)).data);
    expect(label).toMatchObject({ archived: false, color: '#1677ff', name: 'Work', usageCount: 0 });

    await create({ name: 'Alpha' });
    const list = await call('/agent-labels?limit=1', { key: KEYS.ownerRead });
    const page = AgentLabelListSchema.parse((await json(list)).data);
    expect(page.items.map((item) => item.name)).toEqual(['Alpha']);
    expect(page).toMatchObject({ hasMore: true, total: 2 });
    const next = await call(`/agent-labels?cursor=${page.nextCursor}`, { key: KEYS.ownerRead });
    expect((await json(next)).data.items.map((item: any) => item.name)).toEqual(['Work']);

    expect((await call(`/agent-labels/${label.id}`, { key: KEYS.ownerRead })).status).toBe(200);

    const updated = await call(`/agent-labels/${label.id}`, {
      body: { archived: true, color: null, name: 'Work (old)' },
      key: KEYS.ownerWrite,
      method: 'PATCH',
    });
    expect(updated.status).toBe(200);
    expect((await json(updated)).data).toMatchObject({
      archived: true,
      color: null,
      name: 'Work (old)',
    });

    const deleted = await call(`/agent-labels/${label.id}`, {
      key: KEYS.ownerWrite,
      method: 'DELETE',
    });
    expect((await json(deleted)).data).toEqual({ deleted: true, id: label.id });
    expect((await call(`/agent-labels/${label.id}`, { key: KEYS.ownerRead })).status).toBe(404);
  });

  it('answers 409 for a duplicate name', async () => {
    await create({ name: 'Dup' });
    const res = await create({ name: 'Dup' });
    expect(res.status).toBe(409);
  });
});

describe('another account’s label reads as missing', () => {
  it('hides, and refuses to change or delete, a stranger’s label', async () => {
    const theirs = (await json(await create({ name: 'Theirs' }, KEYS.stranger))).data.id;

    expect((await call(`/agent-labels/${theirs}`, { key: KEYS.ownerRead })).status).toBe(404);
    expect(
      (
        await call(`/agent-labels/${theirs}`, {
          body: { name: 'Hijacked' },
          key: KEYS.ownerWrite,
          method: 'PATCH',
        })
      ).status,
    ).toBe(404);
    expect(
      (await call(`/agent-labels/${theirs}`, { key: KEYS.ownerWrite, method: 'DELETE' })).status,
    ).toBe(404);

    const list = await call('/agent-labels', { key: KEYS.ownerRead });
    expect((await json(list)).data.items).toEqual([]);

    const still = await call(`/agent-labels/${theirs}`, { key: KEYS.stranger });
    expect((await json(still)).data.name).toBe('Theirs');
  });
});
