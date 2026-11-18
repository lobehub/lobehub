// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/api/v1/imports` (with `/api/v1/exports` mounted for fixtures) over real HTTP: the real routes
 * behind the auth + workspace middlewares `app.ts` mounts, the real scope
 * gate, controller, REST service and the shared tRPC `exporter` / `importer`
 * procedures, on PGlite. API keys are real `api_keys` rows. Only the database
 * handle and the object storage (an in-memory map) are replaced.
 */
const holder = vi.hoisted(() => {
  process.env.S3_BUCKET ??= 'test-bucket';
  process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');
  return { serverDB: undefined as unknown, store: new Map<string, Buffer>() };
});

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: async () => holder.serverDB }));

vi.mock('@/server/services/file', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  FileService: class {
    createDownloadUrl = async (key: string, name: string) =>
      `https://storage.test/${key}?download=${encodeURIComponent(name)}`;
    getFileContent = async (key: string) => {
      const value = holder.store.get(key);
      if (!value) throw new Error('NoSuchKey');
      return value.toString('utf8');
    };
    getFileMetadata = async (key: string) => {
      const value = holder.store.get(key);
      if (!value) throw new Error('NotFound');
      return { contentLength: value.length };
    };
    getKeyFromFullUrl = async (url: string) => url;
    uploadBuffer = async (key: string, buffer: Buffer) => {
      holder.store.set(key, buffer);
      return { key };
    };
  },
}));

const { getTestDB } = await import('@/database/core/getTestDB');
const { agents, apiKeys, files, users, workspaceMembers, workspaces } =
  await import('@/database/schemas');
const { hashApiKey } = await import('@lobechat/utils/server');
const { HTTPException } = await import('hono/http-exception');
const { errorInitFromException, renderApiError } = await import('../common/errors');
const { userAuthMiddleware } = await import('../middleware/auth');
const { workspaceAuthMiddleware } = await import('../middleware/workspace');
const { ImportResultSchema } = await import('../types/data-transfer.type');
const ExportsRoutes = (await import('./exports.route')).default;
const ImportsRoutes = (await import('./imports.route')).default;

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
app.route('/exports', ExportsRoutes);
app.route('/imports', ImportsRoutes);

const OWNER = 'r12-export-owner';
const STRANGER = 'r12-export-stranger';
const WORKSPACE = 'r12-export-ws';

/** `sk-lh-` + 16 lowercase alphanumerics — the format the auth middleware checks. */
const KEYS = {
  owner: 'sk-lh-r12exportowner01',
  restricted: 'sk-lh-r12exportrestri1',
  stranger: 'sk-lh-r12exportstrang1',
  workspace: 'sk-lh-r12exportwkspce1',
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
  holder.store.clear();
  await serverDB.delete(files);
  await serverDB.delete(agents);
  await serverDB.delete(apiKeys);
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: OWNER }, { id: STRANGER }]);
  await serverDB
    .insert(workspaces)
    .values({ id: WORKSPACE, name: 'R12 export', primaryOwnerId: OWNER, slug: 'r12-export' });
  await serverDB
    .insert(workspaceMembers)
    .values({ role: 'owner', userId: OWNER, workspaceId: WORKSPACE });

  const key = (value: string, userId: string, scopes: string[] | null, workspaceId?: string) => ({
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
      key(KEYS.owner, OWNER, ['*']),
      key(KEYS.restricted, OWNER, ['user:write', 'agent:write', 'model:write']),
      key(KEYS.stranger, STRANGER, null),
      key(KEYS.workspace, OWNER, ['*'], WORKSPACE),
    ]);
});

const exportDump = async () => {
  const res = await call('/exports', { body: { format: 'json' }, key: KEYS.owner, method: 'POST' });
  const { id } = (await json(res)).data;
  return JSON.parse(holder.store.get(`exports/${OWNER}/personal/${id}.json`)!.toString());
};

describe('authentication and API-key scopes', () => {
  const body = {
    data: { agents: [{ id: 'agt_auth_probe', title: 'Probe' }] },
    schemaHash: 'x',
    source: 'export',
  };

  it('answers 401 without credentials', async () => {
    const res = await call('/imports', { body, method: 'POST' });

    expect(res.status).toBe(401);
    expect(await serverDB.select().from(agents)).toHaveLength(0);
  });

  it('refuses a restricted key: an import overwrites credentials and agents', async () => {
    const res = await call('/imports', { body, key: KEYS.restricted, method: 'POST' });

    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('insufficient_scope');
    expect(await serverDB.select().from(agents)).toHaveLength(0);
  });

  it("refuses a workspace header the key's owner does not belong to", async () => {
    const res = await call('/imports', {
      body,
      key: KEYS.stranger,
      method: 'POST',
      workspaceId: WORKSPACE,
    });

    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('workspace_mismatch');
    expect(await serverDB.select().from(agents)).toHaveLength(0);
  });

  it('refuses a workspace key pointed at a different workspace', async () => {
    const res = await call('/imports', {
      body,
      key: KEYS.workspace,
      method: 'POST',
      workspaceId: 'r12-export-other-ws',
    });

    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('workspace_mismatch');
    expect(await serverDB.select().from(agents)).toHaveLength(0);
  });
});

describe('POST /imports', () => {
  it('rejects a body without a known source', async () => {
    for (const body of [
      {},
      { source: 'zip' },
      { source: 'file' },
      { data: {}, source: 'export' },
    ]) {
      const res = await call('/imports', { body, key: KEYS.owner, method: 'POST' });
      expect(res.status).toBe(400);
      expect((await json(res)).code).toBe('validation_error');
    }
  });

  it('imports a legacy config inline', async () => {
    const res = await call('/imports', {
      body: {
        data: {
          sessionGroups: [
            {
              createdAt: 1_736_928_000_000,
              id: 'grp_legacy',
              name: 'Legacy group',
              sort: 0,
              updatedAt: 1_736_928_000_000,
            },
          ],
          version: 7,
        },
        source: 'legacy',
      },
      key: KEYS.stranger,
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const { results } = ImportResultSchema.parse((await json(res)).data);
    expect(results.sessionGroups).toMatchObject({ added: 1, errors: 0 });
  });

  it("imports from one of the caller's own files and leaves the file in place", async () => {
    await serverDB
      .insert(agents)
      .values({ id: 'agt_r12_file', title: 'From a file', userId: OWNER });
    const dump = await exportDump();
    holder.store.set('files/stranger/dump.json', Buffer.from(JSON.stringify(dump)));
    await serverDB.insert(files).values({
      fileType: 'application/json',
      id: 'file_r12_dump',
      name: 'dump.json',
      size: 1,
      url: 'files/stranger/dump.json',
      userId: STRANGER,
    });

    const res = await call('/imports', {
      body: { fileId: 'file_r12_dump', source: 'file' },
      key: KEYS.stranger,
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(ImportResultSchema.parse((await json(res)).data).results.agents).toMatchObject({
      added: 1,
    });
    expect(holder.store.has('files/stranger/dump.json')).toBe(true);
  });

  it("answers 404 for another user's file", async () => {
    holder.store.set('files/stranger/dump.json', Buffer.from('{}'));
    await serverDB.insert(files).values({
      fileType: 'application/json',
      id: 'file_r12_theirs',
      name: 'dump.json',
      size: 1,
      url: 'files/stranger/dump.json',
      userId: STRANGER,
    });

    const res = await call('/imports', {
      body: { fileId: 'file_r12_theirs', source: 'file' },
      key: KEYS.owner,
      method: 'POST',
    });
    expect(res.status).toBe(404);
  });

  it('answers 400 when the file is not an export', async () => {
    holder.store.set('files/owner/notes.txt', Buffer.from('not json'));
    await serverDB.insert(files).values({
      fileType: 'text/plain',
      id: 'file_r12_notes',
      name: 'notes.txt',
      size: 1,
      url: 'files/owner/notes.txt',
      userId: OWNER,
    });

    const res = await call('/imports', {
      body: { fileId: 'file_r12_notes', source: 'file' },
      key: KEYS.owner,
      method: 'POST',
    });
    expect(res.status).toBe(400);
  });

  it('reports an unreadable file as a storage error, not as a non-export', async () => {
    // The row exists but its object is gone from storage.
    await serverDB.insert(files).values({
      fileType: 'application/json',
      id: 'file_r12_gone',
      name: 'gone.json',
      size: 1,
      url: 'files/owner/gone.json',
      userId: OWNER,
    });

    const res = await call('/imports', {
      body: { fileId: 'file_r12_gone', source: 'file' },
      key: KEYS.owner,
      method: 'POST',
    });
    expect(res.status).toBe(503);
    expect((await json(res)).code).toBe('service_unavailable');
  });

  it('counts rows that cannot be written as errors and keeps the rest', async () => {
    const res = await call('/imports', {
      body: {
        data: {
          agents: [{ id: 'agt_r12_ok', title: 'ok' }],
          messages: [{ id: 'msg_r12_bad', role: null }],
        },
        schemaHash: 'any',
        source: 'export',
      },
      key: KEYS.stranger,
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const { results } = ImportResultSchema.parse((await json(res)).data);
    expect(results.agents).toMatchObject({ added: 1, errors: 0 });
    expect(results.messages).toMatchObject({ added: 0, errors: 1 });
  });
});
