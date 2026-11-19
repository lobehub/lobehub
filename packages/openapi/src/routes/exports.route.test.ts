// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/api/v1/exports` and `/api/v1/imports` over real HTTP: the real routes
 * behind the auth + workspace middlewares `app.ts` mounts, the real scope
 * gate, controller, REST service and the shared tRPC `exporter` / `importer`
 * procedures, on PGlite. API keys are real `api_keys` rows. Only the database
 * handle and the object storage (an in-memory map) are replaced.
 */
const holder = vi.hoisted(() => {
  process.env.S3_BUCKET ??= 'test-bucket';
  process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');
  return {
    downloadTtls: [] as number[],
    metadataError: undefined as Error | undefined,
    serverDB: undefined as unknown,
    store: new Map<string, Buffer>(),
    uploadOptions: new Map<string, { private?: boolean } | undefined>(),
  };
});

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: async () => holder.serverDB }));

vi.mock('@/server/services/file', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  FileService: class {
    createDownloadUrl = async (key: string, name: string, ttl?: number) => {
      holder.downloadTtls.push(ttl ?? Number.NaN);
      return `https://storage.test/${key}?download=${encodeURIComponent(name)}`;
    };
    getFileContent = async (key: string) => {
      const value = holder.store.get(key);
      if (!value) throw new Error('NoSuchKey');
      return value.toString('utf8');
    };
    deleteFiles = async (keys: string[]) => {
      for (const key of keys) holder.store.delete(key);
    };
    getFileMetadata = async (key: string) => {
      if (holder.metadataError) throw holder.metadataError;
      const value = holder.store.get(key);
      // The S3 client's HeadObject miss.
      if (!value) throw Object.assign(new Error('NotFound'), { name: 'NotFound' });
      return { contentLength: value.length };
    };
    getKeyFromFullUrl = async (url: string) => url;
    listFileKeys = async (prefix: string) =>
      [...holder.store.keys()].filter((key) => key.startsWith(prefix));
    uploadBuffer = async (key: string, buffer: Buffer, _type: string, options?: object) => {
      holder.store.set(key, buffer);
      holder.uploadOptions.set(key, options);
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
const { ExportSchema, ImportResultSchema } = await import('../types/data-transfer.type');
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
  holder.metadataError = undefined;
  holder.store.clear();
  holder.uploadOptions.clear();
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

describe('authentication and API-key scopes', () => {
  it('answers 401 without credentials', async () => {
    expect((await call('/exports', { body: { format: 'json' }, method: 'POST' })).status).toBe(401);
    expect((await call('/imports', { body: {}, method: 'POST' })).status).toBe(401);
  });

  it('refuses a restricted key: the dump carries stored credentials', async () => {
    const exported = await call('/exports', {
      body: { format: 'json' },
      key: KEYS.restricted,
      method: 'POST',
    });
    expect(exported.status).toBe(403);
    expect((await json(exported)).code).toBe('insufficient_scope');

    const imported = await call('/imports', {
      body: { data: {}, schemaHash: 'x', source: 'export' },
      key: KEYS.restricted,
      method: 'POST',
    });
    expect(imported.status).toBe(403);
    expect((await json(imported)).code).toBe('insufficient_scope');

    expect(holder.store.size).toBe(0);
  });
});

describe('POST /exports', () => {
  it('stores a JSON dump of the caller and answers 202 with a download link', async () => {
    await serverDB
      .insert(agents)
      .values({ id: 'agt_r12_owner', title: 'Owner agent', userId: OWNER });
    await serverDB
      .insert(agents)
      .values({ id: 'agt_r12_other', title: 'Not mine', userId: STRANGER });

    const res = await call('/exports', {
      body: { format: 'json' },
      key: KEYS.owner,
      method: 'POST',
    });
    expect(res.status).toBe(202);
    const data = ExportSchema.parse((await json(res)).data);
    expect(data).toMatchObject({ format: 'json', status: 'completed' });
    expect(data.id).toMatch(/^exp_/);
    expect(data.downloadUrl).toContain(`exports/${OWNER}/personal/${data.id}.json`);

    const stored = JSON.parse(
      holder.store.get(`exports/${OWNER}/personal/${data.id}.json`)!.toString(),
    );
    expect(data.size).toBe(holder.store.get(`exports/${OWNER}/personal/${data.id}.json`)!.length);
    expect(stored.data.agents.map((row: { id: string }) => row.id)).toEqual(['agt_r12_owner']);
    expect(typeof stored.schemaHash).toBe('string');
    // Never public-read, even where S3_SET_ACL grants it to ordinary uploads.
    expect(holder.uploadOptions.get(`exports/${OWNER}/personal/${data.id}.json`)).toEqual({
      private: true,
    });
  });

  it("deletes the caller's expired exports and leaves fresh ones and other users' alone", async () => {
    const day = 24 * 60 * 60 * 1000;
    const stale = `exp_${(Date.now() - 2 * day).toString(36)}_aaaaaaaaaaaaaaaa`;
    const fresh = `exp_${(Date.now() - 60_000).toString(36)}_bbbbbbbbbbbbbbbb`;
    holder.store.set(`exports/${OWNER}/${WORKSPACE}/${stale}.json`, Buffer.from('{}'));
    holder.store.set(`exports/${OWNER}/personal/${fresh}.json`, Buffer.from('{}'));
    holder.store.set(`exports/${STRANGER}/personal/${stale}.json`, Buffer.from('{}'));

    const res = await call('/exports', {
      body: { format: 'json' },
      key: KEYS.owner,
      method: 'POST',
    });
    expect(res.status).toBe(202);

    expect(holder.store.has(`exports/${OWNER}/${WORKSPACE}/${stale}.json`)).toBe(false);
    expect(holder.store.has(`exports/${OWNER}/personal/${fresh}.json`)).toBe(true);
    expect(holder.store.has(`exports/${STRANGER}/personal/${stale}.json`)).toBe(true);
  });

  it('rejects an unknown format and a PDF without content', async () => {
    const unknown = await call('/exports', {
      body: { format: 'xml' },
      key: KEYS.owner,
      method: 'POST',
    });
    expect(unknown.status).toBe(400);
    expect((await json(unknown)).code).toBe('validation_error');

    const pdf = await call('/exports', {
      body: { format: 'pdf' },
      key: KEYS.owner,
      method: 'POST',
    });
    expect(pdf.status).toBe(400);
  });
});

describe('GET /exports/:id', () => {
  const createExport = async (key: string, workspaceId?: string) => {
    const res = await call('/exports', {
      body: { format: 'json' },
      key,
      method: 'POST',
      workspaceId,
    });
    expect(res.status).toBe(202);
    return (await json(res)).data.id as string;
  };

  it("returns the caller's export with a fresh link", async () => {
    const id = await createExport(KEYS.owner);
    const res = await call(`/exports/${id}`, { key: KEYS.owner });
    expect(res.status).toBe(200);
    expect(ExportSchema.parse((await json(res)).data)).toMatchObject({ format: 'json', id });
  });

  it('answers 404 for an export past its retention and deletes it', async () => {
    const stale = `exp_${(Date.now() - 2 * 24 * 60 * 60 * 1000).toString(36)}_cccccccccccccccc`;
    holder.store.set(`exports/${OWNER}/personal/${stale}.json`, Buffer.from('{}'));

    expect((await call(`/exports/${stale}`, { key: KEYS.owner })).status).toBe(404);
    expect(holder.store.has(`exports/${OWNER}/personal/${stale}.json`)).toBe(false);
  });

  it('never signs a link that outlives the export retention', async () => {
    // 23h59m into the 24h window: the signed lifetime must be the minute that
    // is left, not another full hour.
    const nearExpiry = `exp_${(Date.now() - (23 * 60 * 60 * 1000 + 59 * 60 * 1000)).toString(36)}_dddddddddddddddd`;
    holder.store.set(`exports/${OWNER}/personal/${nearExpiry}.json`, Buffer.from('{}'));

    const res = await call(`/exports/${nearExpiry}`, { key: KEYS.owner });
    expect(res.status).toBe(200);
    const data = ExportSchema.parse((await json(res)).data);

    const ttl = holder.downloadTtls.at(-1)!;
    expect(ttl).toBeLessThanOrEqual(60);
    expect(ttl).toBeGreaterThan(0);
    expect(new Date(data.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(61_000);
  });

  it('reports a storage failure as an error, not as a missing export', async () => {
    const id = await createExport(KEYS.owner);
    holder.metadataError = new Error('socket hang up');

    const res = await call(`/exports/${id}`, { key: KEYS.owner });
    expect(res.status).toBe(503);
    expect((await json(res)).code).toBe('service_unavailable');
  });

  it("answers 404 for another user's export and outside the workspace it was made in", async () => {
    const id = await createExport(KEYS.owner);
    expect((await call(`/exports/${id}`, { key: KEYS.stranger })).status).toBe(404);

    const workspaceExport = await createExport(KEYS.workspace, WORKSPACE);
    expect(holder.store.has(`exports/${OWNER}/${WORKSPACE}/${workspaceExport}.json`)).toBe(true);
    expect((await call(`/exports/${workspaceExport}`, { key: KEYS.owner })).status).toBe(404);
    expect(
      (await call(`/exports/${workspaceExport}`, { key: KEYS.workspace, workspaceId: WORKSPACE }))
        .status,
    ).toBe(200);
  });

  it('rejects a malformed id', async () => {
    const res = await call('/exports/..%2Fsecret', { key: KEYS.owner });
    expect(res.status).toBe(400);
  });
});

describe('export → import round trip', () => {
  it("imports one user's export into another user's account", async () => {
    await serverDB
      .insert(agents)
      .values({ id: 'agt_r12_trip', title: 'Travelling agent', userId: OWNER });

    const exported = await call('/exports', {
      body: { format: 'json' },
      key: KEYS.owner,
      method: 'POST',
    });
    const { id } = (await json(exported)).data;
    const dump = JSON.parse(holder.store.get(`exports/${OWNER}/personal/${id}.json`)!.toString());

    const res = await call('/imports', {
      body: { ...dump, source: 'export' },
      key: KEYS.stranger,
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const { results } = ImportResultSchema.parse((await json(res)).data);
    expect(results.agents).toMatchObject({ added: 1, errors: 0 });

    const strangerAgents = await serverDB.query.agents.findMany({
      where: (table, { eq }) => eq(table.userId, STRANGER),
    });
    expect(strangerAgents.map((agent) => agent.title)).toEqual(['Travelling agent']);
  });
});
