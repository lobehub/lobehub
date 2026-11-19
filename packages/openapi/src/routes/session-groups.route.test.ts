// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/api/v1/session-groups` over real HTTP on PGlite: real auth, workspace and
 * scope middlewares, controller, REST service and the shared `sessionGroup` /
 * `home` procedures. API keys are real `api_keys` rows.
 */
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');

const holder = vi.hoisted(() => ({ serverDB: undefined as unknown }));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => holder.serverDB,
}));

const { getTestDB } = await import('@/database/core/getTestDB');
const { agents, apiKeys, users } = await import('@/database/schemas');
const { buildRouteApp, json, seedUsersAndKeys } = await import('./__tests__/pglite-harness');
const { SessionGroupListSchema, SessionGroupSchema } = await import('../types/session-group.type');
const SessionGroupRoutes = (await import('./session-groups.route')).default;

const serverDB = await getTestDB();
holder.serverDB = serverDB;

const { call } = buildRouteApp({ 'session-groups': SessionGroupRoutes });

const OWNER = 'r8-folder-owner';
const STRANGER = 'r8-folder-stranger';
const AGENT = 'agt_r8_folder_owner';
const STRANGER_AGENT = 'agt_r8_folder_stranger';

const KEYS = {
  chatOnly: 'sk-lh-r8folderchatonly',
  ownerRead: 'sk-lh-r8folderownerrea',
  ownerWrite: 'sk-lh-r8folderownerwri',
  stranger: 'sk-lh-r8folderstranger',
} as const;

const create = (body: Record<string, unknown>, key: string = KEYS.ownerWrite) =>
  call('/session-groups', { body, key, method: 'POST' });
const createId = async (name: string, key: string = KEYS.ownerWrite) =>
  (await json(await create({ name }, key))).data.id as string;
const agentRow = (id: string) =>
  serverDB.query.agents.findFirst({ where: (table, { eq }) => eq(table.id, id) });

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
  await serverDB.insert(agents).values([
    { id: AGENT, title: 'Owner agent', userId: OWNER },
    { id: STRANGER_AGENT, title: 'Stranger agent', userId: STRANGER },
  ]);
});

describe('authentication, API-key scopes and workspace header', () => {
  it('answers 401 without credentials', async () => {
    expect((await call('/session-groups')).status).toBe(401);
    expect((await call('/session-groups', { body: { name: 'x' }, method: 'POST' })).status).toBe(
      401,
    );
  });

  it('refuses a key without an agent scope, and agent:read writing', async () => {
    const res = await call('/session-groups', { key: KEYS.chatOnly });
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('insufficient_scope');

    expect((await call('/session-groups', { key: KEYS.ownerRead })).status).toBe(200);
    expect((await create({ name: 'Nope' }, KEYS.ownerRead)).status).toBe(403);
    const move = await call('/session-groups/move-agents', {
      body: { agentIds: [AGENT], sessionGroupId: null },
      key: KEYS.ownerRead,
      method: 'POST',
    });
    expect(move.status).toBe(403);
  });

  it('rejects an X-Workspace-Id the personal key does not belong to', async () => {
    const res = await call('/session-groups', {
      headers: { 'X-Workspace-Id': 'ws_other' },
      key: KEYS.ownerRead,
    });
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('workspace_mismatch');
  });
});

describe('request validation', () => {
  it('rejects an empty name, an unknown visibility and a private re-scope', async () => {
    const empty = await create({ name: '' });
    expect(empty.status).toBe(400);
    expect(JSON.stringify(await json(empty))).toContain('Session group name cannot be empty');

    expect((await create({ name: 'X', visibility: 'secret' })).status).toBe(400);

    const id = await createId('Folder');
    const privatise = await call(`/session-groups/${id}`, {
      body: { visibility: 'private' },
      key: KEYS.ownerWrite,
      method: 'PATCH',
    });
    expect(privatise.status).toBe(400);
  });

  it('rejects an empty reorder and a move without a target', async () => {
    const reorder = await call('/session-groups/reorder', {
      body: { items: [] },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(reorder.status).toBe(400);
    expect(JSON.stringify(await json(reorder))).toContain('At least one session group');

    const move = await call('/session-groups/move-agents', {
      body: { agentIds: [AGENT] },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(move.status).toBe(400);
    expect(JSON.stringify(await json(move))).toContain('sessionGroupId');
  });
});

describe('folder CRUD and ordering', () => {
  it('creates, lists, reads, renames and deletes a folder', async () => {
    const created = await create({ name: 'Work', sort: 2 });
    expect(created.status).toBe(201);
    const folder = SessionGroupSchema.parse((await json(created)).data);
    expect(folder).toMatchObject({ name: 'Work', sort: 2, visibility: 'public' });

    const list = await call('/session-groups', { key: KEYS.ownerRead });
    const page = SessionGroupListSchema.parse((await json(list)).data);
    expect(page.items.map((item) => item.id)).toEqual([folder.id]);
    expect(page.total).toBe(1);

    const renamed = await call(`/session-groups/${folder.id}`, {
      body: { name: 'Work 2' },
      key: KEYS.ownerWrite,
      method: 'PATCH',
    });
    expect((await json(renamed)).data.name).toBe('Work 2');

    const deleted = await call(`/session-groups/${folder.id}`, {
      key: KEYS.ownerWrite,
      method: 'DELETE',
    });
    expect((await json(deleted)).data).toEqual({ deleted: true, id: folder.id });
    expect((await call(`/session-groups/${folder.id}`, { key: KEYS.ownerRead })).status).toBe(404);
  });

  it('reorders folders in one call', async () => {
    const a = await createId('A');
    const b = await createId('B');

    const res = await call('/session-groups/reorder', {
      body: {
        items: [
          { id: b, sort: 0 },
          { id: a, sort: 1 },
        ],
      },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect((await json(res)).data.items.map((item: any) => [item.id, item.sort])).toEqual([
      [b, 0],
      [a, 1],
    ]);

    const list = await call('/session-groups', { key: KEYS.ownerRead });
    expect((await json(list)).data.items.map((item: any) => item.id)).toEqual([b, a]);
  });
});

describe('moving agents', () => {
  it('files an agent under a folder and takes it out again', async () => {
    const folder = await createId('Work');

    const moved = await call('/session-groups/move-agents', {
      body: { agentIds: [AGENT], sessionGroupId: folder },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(moved.status).toBe(200);
    expect((await json(moved)).data).toEqual({ agentIds: [AGENT], sessionGroupId: folder });
    expect((await agentRow(AGENT))?.sessionGroupId).toBe(folder);

    await call('/session-groups/move-agents', {
      body: { agentIds: [AGENT], sessionGroupId: null },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect((await agentRow(AGENT))?.sessionGroupId).toBeNull();
  });
});

describe('another account’s folders and agents read as missing', () => {
  it('hides, and refuses to change, reorder or delete, a stranger’s folder', async () => {
    const theirs = await createId('Theirs', KEYS.stranger);

    expect((await call(`/session-groups/${theirs}`, { key: KEYS.ownerRead })).status).toBe(404);
    const rename = await call(`/session-groups/${theirs}`, {
      body: { name: 'Hijacked' },
      key: KEYS.ownerWrite,
      method: 'PATCH',
    });
    expect(rename.status).toBe(404);
    const reorder = await call('/session-groups/reorder', {
      body: { items: [{ id: theirs, sort: 9 }] },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(reorder.status).toBe(404);
    expect(
      (await call(`/session-groups/${theirs}`, { key: KEYS.ownerWrite, method: 'DELETE' })).status,
    ).toBe(404);

    const still = await call(`/session-groups/${theirs}`, { key: KEYS.stranger });
    expect((await json(still)).data).toMatchObject({ name: 'Theirs', sort: null });
  });

  it('refuses to file into a stranger’s folder or move a stranger’s agent', async () => {
    const theirs = await createId('Theirs', KEYS.stranger);
    const mine = await createId('Mine');

    const intoTheirs = await call('/session-groups/move-agents', {
      body: { agentIds: [AGENT], sessionGroupId: theirs },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(intoTheirs.status).toBe(404);

    const theirAgent = await call('/session-groups/move-agents', {
      body: { agentIds: [STRANGER_AGENT], sessionGroupId: mine },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(theirAgent.status).toBe(404);
    expect((await agentRow(STRANGER_AGENT))?.sessionGroupId).toBeNull();
  });
});
