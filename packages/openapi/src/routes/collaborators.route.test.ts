// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/api/v1/{agents|agent-groups|documents|knowledge-bases}/{id}/collaborators`
 * over real HTTP: the real collaborator routes behind the same auth +
 * workspace middlewares `app.ts` mounts, the real scope gates, controller,
 * REST service and the shared `resourcePermission` procedures, on a PGlite
 * database. API keys are real `api_keys` rows; only the database handle is
 * pointed at PGlite.
 */
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');

const holder = vi.hoisted(() => ({ serverDB: undefined as unknown }));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => holder.serverDB,
}));

const { getTestDB } = await import('@/database/core/getTestDB');
const { agents, apiKeys, documents, resourcePermissions, users, workspaceMembers, workspaces } =
  await import('@/database/schemas');
const { hashApiKey } = await import('@lobechat/utils/server');
const { HTTPException } = await import('hono/http-exception');
const { errorInitFromException, renderApiError } = await import('../common/errors');
const { userAuthMiddleware } = await import('../middleware/auth');
const { workspaceAuthMiddleware } = await import('../middleware/workspace');
const { collaboratorRouteEntries } = await import('./collaborators.route');

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
for (const [path, routes] of Object.entries(collaboratorRouteEntries))
  app.route(`/${path}`, routes);

const OWNER = 'r9-collab-owner';
const MEMBER = 'r9-collab-member';
const OTHER_MEMBER = 'r9-collab-member2';
const STRANGER = 'r9-collab-stranger';
const WORKSPACE = 'r9-collab-ws';
const OTHER_WORKSPACE = 'r9-collab-other-ws';
const AGENT = 'agt_r9collab';
const PRIVATE_AGENT = 'agt_r9collabpriv';
const DOCUMENT = 'docs_r9collab';

/** `sk-lh-` + 16 lowercase alphanumerics — the format the auth middleware checks. */
const KEYS = {
  member: 'sk-lh-r9collabmember01',
  ownerFull: 'sk-lh-r9collabownerful',
  ownerPersonal: 'sk-lh-r9collabownerper',
  ownerRead: 'sk-lh-r9collabownerrea',
  ownerWsBound: 'sk-lh-r9collabownerwsb',
  stranger: 'sk-lh-r9collabstranger',
  strangerInWs: 'sk-lh-r9collabstrangin',
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

beforeEach(async () => {
  await serverDB.delete(resourcePermissions);
  await serverDB.delete(documents);
  await serverDB.delete(agents);
  await serverDB.delete(apiKeys);
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB
    .insert(users)
    .values([
      { email: 'owner@r9.test', id: OWNER },
      { email: 'member@r9.test', fullName: 'Member One', id: MEMBER },
      { id: OTHER_MEMBER },
      { id: STRANGER },
    ]);
  await serverDB.insert(workspaces).values([
    { id: WORKSPACE, name: 'R9 collab', primaryOwnerId: OWNER, slug: 'r9-collab' },
    { id: OTHER_WORKSPACE, name: 'R9 other', primaryOwnerId: STRANGER, slug: 'r9-collab-other' },
  ]);
  await serverDB.insert(workspaceMembers).values([
    { role: 'owner', userId: OWNER, workspaceId: WORKSPACE },
    { role: 'member', userId: MEMBER, workspaceId: WORKSPACE },
    { role: 'member', userId: OTHER_MEMBER, workspaceId: WORKSPACE },
    { role: 'owner', userId: STRANGER, workspaceId: OTHER_WORKSPACE },
  ]);
  await serverDB.insert(agents).values([
    {
      id: AGENT,
      title: 'Shared agent',
      userId: OWNER,
      visibility: 'public',
      workspaceId: WORKSPACE,
    },
    {
      id: PRIVATE_AGENT,
      title: 'Private agent',
      userId: OTHER_MEMBER,
      visibility: 'private',
      workspaceId: WORKSPACE,
    },
  ]);
  await serverDB.insert(documents).values({
    content: '',
    fileType: 'custom/document',
    id: DOCUMENT,
    source: 'api',
    sourceType: 'api',
    title: 'Spec',
    totalCharCount: 0,
    totalLineCount: 0,
    userId: OWNER,
    workspaceId: WORKSPACE,
  });

  const key = (value: string, userId: string, scopes: string[], workspaceId?: string) => ({
    key: value,
    keyHash: hashApiKey(value),
    name: value,
    scopes,
    userId,
    workspaceId: workspaceId ?? null,
  });
  await serverDB.insert(apiKeys).values([
    // Only a workspace-bound key may address a workspace; a personal key may not.
    key(KEYS.ownerFull, OWNER, ['*'], WORKSPACE),
    key(KEYS.ownerPersonal, OWNER, ['*']),
    key(KEYS.ownerRead, OWNER, ['workspace:read'], WORKSPACE),
    key(KEYS.ownerWsBound, OWNER, ['*'], WORKSPACE),
    key(KEYS.member, MEMBER, ['*'], WORKSPACE),
    key(KEYS.stranger, STRANGER, ['*'], OTHER_WORKSPACE),
    // A key whose workspace binding outlived the membership.
    key(KEYS.strangerInWs, STRANGER, ['*'], WORKSPACE),
  ]);
});

const base = `/agents/${AGENT}/collaborators`;

describe('authentication and API-key scopes', () => {
  it('answers 401 without credentials', async () => {
    const res = await call(base, { workspaceId: WORKSPACE });

    expect(res.status).toBe(401);
  });

  it('keeps restricted keys out entirely — reads expose who has access', async () => {
    const list = await call(base, { key: KEYS.ownerRead, workspaceId: WORKSPACE });
    expect(list.status).toBe(403);
    expect((await json(list)).code).toBe('insufficient_scope');

    const add = await call(base, {
      body: { accessLevel: 'view', userIds: [MEMBER] },
      key: KEYS.ownerRead,
      method: 'POST',
      workspaceId: WORKSPACE,
    });
    expect(add.status).toBe(403);
    expect((await json(add)).code).toBe('insufficient_scope');
  });
});

describe('workspace isolation', () => {
  it('rejects a personal request — permissions only exist inside a workspace', async () => {
    const res = await call(base, { key: KEYS.ownerPersonal });

    expect(res.status).toBe(400);
  });

  it('refuses a personal key that names a workspace', async () => {
    const res = await call(base, { key: KEYS.ownerPersonal, workspaceId: WORKSPACE });

    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('workspace_mismatch');
  });

  it('rejects a workspace-bound key addressing another workspace', async () => {
    const res = await call(base, { key: KEYS.ownerWsBound, workspaceId: OTHER_WORKSPACE });

    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('workspace_mismatch');
  });

  it('rejects a caller who is not a member of the workspace', async () => {
    const res = await call(base, { key: KEYS.strangerInWs });

    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('workspace_mismatch');
  });

  it('answers 404 for a resource of another workspace', async () => {
    const res = await call(base, { key: KEYS.stranger, workspaceId: OTHER_WORKSPACE });

    expect(res.status).toBe(404);
  });

  it("answers 404 for another member's private resource", async () => {
    const res = await call(`/agents/${PRIVATE_AGENT}/collaborators`, {
      key: KEYS.ownerFull,
      workspaceId: WORKSPACE,
    });

    expect(res.status).toBe(404);
  });

  it('forbids a member who is neither creator nor owner from managing', async () => {
    const res = await call(base, {
      body: { accessLevel: 'view', userIds: [OTHER_MEMBER] },
      key: KEYS.member,
      method: 'POST',
      workspaceId: WORKSPACE,
    });

    expect(res.status).toBe(403);
  });
});

describe('request validation', () => {
  it.each([
    ['an unknown access level', { accessLevel: 'admin', userIds: [MEMBER] }],
    ['an empty user list', { accessLevel: 'view', userIds: [] }],
    ['an unknown field', { accessLevel: 'view', role: 'editor', userIds: [MEMBER] }],
  ])('rejects %s', async (_label, body) => {
    const res = await call(base, {
      body,
      key: KEYS.ownerFull,
      method: 'POST',
      workspaceId: WORKSPACE,
    });

    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe('validation_error');
  });

  it('rejects a level the resource type does not support', async () => {
    const res = await call(`/documents/${DOCUMENT}/collaborators`, {
      body: { accessLevel: 'use', userIds: [MEMBER] },
      key: KEYS.ownerFull,
      method: 'POST',
      workspaceId: WORKSPACE,
    });

    expect(res.status).toBe(400);
  });

  it('rejects a collaborator who is not a workspace member', async () => {
    const res = await call(base, {
      body: { accessLevel: 'view', userIds: [STRANGER] },
      key: KEYS.ownerFull,
      method: 'POST',
      workspaceId: WORKSPACE,
    });

    expect(res.status).toBe(400);
  });
});

describe('collaborator lifecycle', () => {
  it('adds, lists, changes and removes a collaborator', async () => {
    const added = await call(base, {
      body: { accessLevel: 'view', userIds: [MEMBER] },
      key: KEYS.ownerFull,
      method: 'POST',
      workspaceId: WORKSPACE,
    });
    expect(added.status).toBe(200);
    expect((await json(added)).data.items).toEqual([
      expect.objectContaining({
        accessLevel: 'view',
        user: expect.objectContaining({ fullName: 'Member One', id: MEMBER }),
        userId: MEMBER,
      }),
    ]);

    await call(base, {
      body: { accessLevel: 'edit', userIds: [MEMBER] },
      key: KEYS.ownerFull,
      method: 'POST',
      workspaceId: WORKSPACE,
    });

    // A workspace-bound key needs no header.
    const listed = await call(base, { key: KEYS.ownerWsBound });
    expect(listed.status).toBe(200);
    const page = (await json(listed)).data;
    expect(page).toMatchObject({ hasMore: false, nextCursor: null, total: 1 });
    expect(page.items[0]).toMatchObject({ accessLevel: 'edit', userId: MEMBER });

    const removed = await call(`${base}/${MEMBER}`, {
      key: KEYS.ownerFull,
      method: 'DELETE',
      workspaceId: WORKSPACE,
    });
    expect(removed.status).toBe(200);
    expect((await json(removed)).data).toEqual({ deleted: true, id: MEMBER });

    const after = await call(base, { key: KEYS.ownerFull, workspaceId: WORKSPACE });
    expect((await json(after)).data.items).toEqual([]);
  });

  it('works for documents through their own segment', async () => {
    const res = await call(`/documents/${DOCUMENT}/collaborators`, {
      body: { accessLevel: 'edit', userIds: [MEMBER] },
      key: KEYS.ownerFull,
      method: 'POST',
      workspaceId: WORKSPACE,
    });

    expect(res.status).toBe(200);
    expect((await json(res)).data.items[0]).toMatchObject({ accessLevel: 'edit', userId: MEMBER });
  });
});

describe('general access', () => {
  it('reads the default and sets an explicit level', async () => {
    const before = await call(`${base}/general-access`, {
      key: KEYS.ownerFull,
      workspaceId: WORKSPACE,
    });
    expect(before.status).toBe(200);
    expect((await json(before)).data).toEqual({
      accessLevel: 'edit',
      canManage: true,
      creatorId: OWNER,
      visibility: 'public',
    });

    const set = await call(`${base}/general-access`, {
      body: { accessLevel: 'view' },
      key: KEYS.ownerFull,
      method: 'PUT',
      workspaceId: WORKSPACE,
    });
    expect(set.status).toBe(200);
    expect((await json(set)).data).toMatchObject({ accessLevel: 'view', canManage: true });

    const asMember = await call(`${base}/general-access`, {
      key: KEYS.member,
      workspaceId: WORKSPACE,
    });
    expect((await json(asMember)).data).toMatchObject({ accessLevel: 'view', canManage: false });
  });

  it('forbids a non-manager from changing it', async () => {
    const res = await call(`${base}/general-access`, {
      body: { accessLevel: 'view' },
      key: KEYS.member,
      method: 'PUT',
      workspaceId: WORKSPACE,
    });

    expect(res.status).toBe(403);
  });
});
