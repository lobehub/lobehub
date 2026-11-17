// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/api/v1/users/me/settings` and `/users/me/profile` over real HTTP: the real
 * `UserRoutes` behind the auth + workspace middlewares `app.ts` mounts, real
 * API-key rows, the real scope gates and the `user` tRPC procedures the
 * service calls, on PGlite. Only the database handle and object storage are
 * replaced.
 */
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');

const holder = vi.hoisted(() => ({
  deleted: [] as string[],
  serverDB: undefined as unknown,
  uploaded: [] as { mimeType: string; path: string; size: number }[],
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => holder.serverDB,
}));
vi.mock('@/server/modules/S3', () => ({
  FileS3: class {
    async uploadBuffer(path: string, buffer: Buffer, mimeType: string) {
      holder.uploaded.push({ mimeType, path, size: buffer.length });
    }
    async deleteFile(path: string) {
      holder.deleted.push(path);
    }
  },
}));

const { getTestDB } = await import('@/database/core/getTestDB');
const { apiKeys, userSettings, users, workspaceMembers, workspaces } =
  await import('@/database/schemas');
const { hashApiKey } = await import('@lobechat/utils/server');
const { eq } = await import('drizzle-orm');
const { HTTPException } = await import('hono/http-exception');
const { errorInitFromException, renderApiError } = await import('../common/errors');
const { userAuthMiddleware } = await import('../middleware/auth');
const { workspaceAuthMiddleware } = await import('../middleware/workspace');
const { UserProfileSchema, UserSettingsSchema } = await import('../types/user-settings.type');
const UserRoutes = (await import('./users.route')).default;

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
app.route('/users', UserRoutes);

const OWNER = 'r12-me-owner';
const OTHER = 'r12-me-other';
const MEMBER = 'r12-me-member';
const WORKSPACE = 'r12-me-ws';

/** `sk-lh-` + 16 lowercase alphanumerics — the format the auth middleware checks. */
const KEYS = {
  chatOnly: 'sk-lh-r12mechatonly000',
  member: 'sk-lh-r12mememberkey00',
  memberWs: 'sk-lh-r12mememberws000',
  other: 'sk-lh-r12meotherkey000',
  read: 'sk-lh-r12mereadkey0000',
  write: 'sk-lh-r12mewritekey000',
} as const;

const call = (
  path: string,
  init: { body?: unknown; key?: string; method?: string; workspaceId?: string } = {},
) =>
  app.request(`/api/v1/users${path}`, {
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
  holder.uploaded = [];
  holder.deleted = [];
  await serverDB.delete(apiKeys);
  await serverDB.delete(userSettings);
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB
    .insert(users)
    .values([
      { avatar: '/webapi/user/avatar/r12-me-owner/old.png', id: OWNER, username: 'owner_one' },
      { id: OTHER, username: 'taken_name' },
      { id: MEMBER },
    ]);
  await serverDB.insert(userSettings).values([
    {
      general: { fontSize: 14, language: 'en-US' },
      id: OWNER,
      keyVaults: 'encrypted-provider-keys',
      market: { accessToken: 'market-secret' },
      tool: { humanIntervention: { allowList: ['a', 'b'], approvalMode: 'manual' } },
    },
    { general: { language: 'zh-CN' }, id: OTHER },
  ]);
  await serverDB
    .insert(workspaces)
    .values([{ id: WORKSPACE, name: 'R12 me', primaryOwnerId: OWNER, slug: 'r12-me' }]);
  await serverDB.insert(workspaceMembers).values([
    { role: 'owner', userId: OWNER, workspaceId: WORKSPACE },
    { role: 'member', userId: MEMBER, workspaceId: WORKSPACE },
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
      key(KEYS.read, OWNER, ['user:read']),
      key(KEYS.write, OWNER, ['user:write']),
      key(KEYS.chatOnly, OWNER, ['chat:write']),
      key(KEYS.other, OTHER, ['user:write']),
      key(KEYS.member, MEMBER, ['user:write']),
      key(KEYS.memberWs, MEMBER, ['user:write'], WORKSPACE),
    ]);
});

describe('GET /users/me/settings', () => {
  it('answers 401 without credentials', async () => {
    expect((await call('/me/settings')).status).toBe(401);
  });

  it('refuses a key without user:read', async () => {
    const res = await call('/me/settings', { key: KEYS.chatOnly });

    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('insufficient_scope');
  });

  it("returns only the caller's settings, with credentials stripped", async () => {
    const res = await call('/me/settings', { key: KEYS.read });
    expect(res.status).toBe(200);

    const { data } = await json(res);
    expect(UserSettingsSchema.parse(data)).toEqual(data);
    expect(data.settings.general).toEqual({ fontSize: 14, language: 'en-US' });
    expect(data.settings).not.toHaveProperty('keyVaults');
    expect(data.settings).not.toHaveProperty('market');
    expect(JSON.stringify(data)).not.toContain('secret');
    expect(JSON.stringify(data)).not.toContain('encrypted-provider-keys');

    const other = await json(await call('/me/settings', { key: KEYS.other }));
    expect(other.data.settings.general).toEqual({ language: 'zh-CN' });
  });
});

describe('PATCH /users/me/settings', () => {
  it('refuses a read-only key', async () => {
    const res = await call('/me/settings', {
      body: { settings: { general: { fontSize: 16 } } },
      key: KEYS.read,
      method: 'PATCH',
    });

    expect(res.status).toBe(403);
  });

  it('deep-merges sections and preference, replacing arrays', async () => {
    const res = await call('/me/settings', {
      body: {
        preference: { useCmdEnterToSend: true },
        settings: {
          general: { fontSize: 16 },
          tool: { humanIntervention: { allowList: ['c'] } },
        },
      },
      key: KEYS.write,
      method: 'PATCH',
    });
    expect(res.status).toBe(200);

    const { data } = await json(res);
    expect(data.settings.general).toEqual({ fontSize: 16, language: 'en-US' });
    expect(data.settings.tool).toEqual({
      humanIntervention: { allowList: ['c'], approvalMode: 'manual' },
    });
    expect(data.preference.useCmdEnterToSend).toBe(true);

    // credentials the request never named stay as they were
    const [row] = await serverDB.select().from(userSettings).where(eq(userSettings.id, OWNER));
    expect(row.keyVaults).toBe('encrypted-provider-keys');
    expect(row.market).toEqual({ accessToken: 'market-secret' });
  });

  it('refuses credential sections, unknown sections and an empty body', async () => {
    for (const body of [
      { settings: { keyVaults: { openai: { apiKey: 'sk-x' } } } },
      { settings: { market: { accessToken: 'x' } } },
      { settings: { nope: {} } },
      {},
      { settings: { general: 'dark' } },
    ]) {
      const res = await call('/me/settings', { body, key: KEYS.write, method: 'PATCH' });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("keeps a workspace member's write off owner-level settings", async () => {
    const res = await call('/me/settings', {
      body: { settings: { systemAgent: { topic: { model: 'gpt-5' } } } },
      key: KEYS.memberWs,
      method: 'PATCH',
      workspaceId: WORKSPACE,
    });

    expect(res.status).toBe(403);
    expect((await json(res)).message).toBe('You do not have permission to perform this action.');

    // a personal section is still the member's own to change in the workspace
    const general = await call('/me/settings', {
      body: { settings: { general: { fontSize: 18 } } },
      key: KEYS.memberWs,
      method: 'PATCH',
      workspaceId: WORKSPACE,
    });
    expect(general.status).toBe(200);
  });

  it('refuses a personal key that names a workspace', async () => {
    const res = await call('/me/settings', { key: KEYS.member, workspaceId: WORKSPACE });

    expect(res.status).toBe(403);
  });
});

describe('PATCH /users/me/profile', () => {
  it('answers 401 without credentials and 403 without user:write', async () => {
    expect((await call('/me/profile', { body: { fullName: 'X' }, method: 'PATCH' })).status).toBe(
      401,
    );
    expect(
      (await call('/me/profile', { body: { fullName: 'X' }, key: KEYS.read, method: 'PATCH' }))
        .status,
    ).toBe(403);
  });

  it('updates the name and username', async () => {
    const res = await call('/me/profile', {
      body: { fullName: 'Ada Lovelace', username: 'ada_l' },
      key: KEYS.write,
      method: 'PATCH',
    });
    expect(res.status).toBe(200);

    const { data } = await json(res);
    expect(UserProfileSchema.parse(data)).toEqual({
      avatar: '/webapi/user/avatar/r12-me-owner/old.png',
      email: null,
      fullName: 'Ada Lovelace',
      id: OWNER,
      username: 'ada_l',
    });
  });

  it("answers 409 for another user's username and changes nothing", async () => {
    const res = await call('/me/profile', {
      body: { fullName: 'Changed', username: 'taken_name' },
      key: KEYS.write,
      method: 'PATCH',
    });

    expect(res.status).toBe(409);
    const [row] = await serverDB.select().from(users).where(eq(users.id, OWNER));
    expect(row.fullName).toBeNull();
    expect(row.username).toBe('owner_one');
  });

  it('uploads a data-URL avatar and removes the previous upload', async () => {
    const png = `data:image/png;base64,${Buffer.from('fake-png').toString('base64')}`;
    const res = await call('/me/profile', {
      body: { avatar: png },
      key: KEYS.write,
      method: 'PATCH',
    });
    expect(res.status).toBe(200);

    const { data } = await json(res);
    expect(data.avatar).toMatch(/^\/webapi\/user\/avatar\/r12-me-owner\/[\w-]+\.png$/);
    expect(holder.uploaded).toEqual([
      { mimeType: 'image/png', path: data.avatar.slice('/webapi/'.length), size: 8 },
    ]);
    expect(holder.deleted).toEqual(['user/avatar/r12-me-owner/old.png']);
  });

  it('stores an https avatar as is', async () => {
    const res = await call('/me/profile', {
      body: { avatar: 'https://cdn.example.com/me.png' },
      key: KEYS.write,
      method: 'PATCH',
    });

    expect((await json(res)).data.avatar).toBe('https://cdn.example.com/me.png');
    expect(holder.uploaded).toEqual([]);
  });

  it('refuses invalid input', async () => {
    for (const body of [
      {},
      { username: 'has space' },
      { avatar: 'file:///etc/passwd' },
      { avatar: 'data:image/gif;base64,R0lGOD' },
      { email: 'x@example.com' },
    ]) {
      const res = await call('/me/profile', { body, key: KEYS.write, method: 'PATCH' });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });
});
