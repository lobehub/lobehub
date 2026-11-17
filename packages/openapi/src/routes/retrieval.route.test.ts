// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Retrieval over real HTTP: `POST /knowledge-bases/{id}/search`,
 * `POST /files/search`, `POST /files/{id}/embeddings` and
 * `POST /files/{id}/parses/retry`, behind the same auth + workspace
 * middlewares `app.ts` mounts, the real permission/scope gates, controller,
 * REST service, `KnowledgeBaseSearchService` and `ChunkService`, on PGlite.
 * API keys are real `api_keys` rows. Only the edges that leave the process are
 * stubbed: the embedding provider (a fixed vector per query) and the async
 * router the chunk service hands parse/embed work to.
 */
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');

const DIM = 1024;
/** A unit vector along `axis` — cosine similarity between two of them is 1 or 0. */
const axis = (index: number) => Array.from({ length: DIM }, (_, i) => (i === index ? 1 : 0));

const holder = vi.hoisted(() => ({
  /** What the embedding provider rejects with, when set. */
  embeddingsFail: undefined as unknown,
  /** Knowledge-base ids the access guards treat as restricted for the caller. */
  restricted: new Set<string>(),
  serverDB: undefined as unknown,
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => holder.serverDB,
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: async () => ({
    // Queries mentioning "design" land on axis 0, anything else on axis 1.
    embeddings: async ({ input }: { input: string | string[] }) => {
      if (holder.embeddingsFail) throw holder.embeddingsFail;
      const texts = Array.isArray(input) ? input : [input];
      return texts.map((text) => axis(text.includes('design') ? 0 : 1));
    },
  }),
}));

// Restriction needs workspace RBAC rows; the REST contract under test is only
// that a guard refusal becomes a 403 and nothing is searched or queued.
vi.mock('@/server/services/knowledgeBaseAccess', async (importOriginal) => {
  const { TRPCError } = await import('@trpc/server');
  const actual = await importOriginal<Record<string, unknown>>();
  const { getTestDB } = await import('@/database/core/getTestDB');
  const refuse = () => {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Restricted knowledge base' });
  };
  const fileIsRestricted = async (fileId: string) => {
    const db = (await getTestDB()) as any;
    const rows = await db.query.knowledgeBaseFiles.findMany({
      where: (t: any, { eq }: any) => eq(t.fileId, fileId),
    });
    return rows.some((row: { knowledgeBaseId: string }) =>
      holder.restricted.has(row.knowledgeBaseId),
    );
  };
  return {
    ...actual,
    assertContentsNotInRestrictedKnowledgeBase: async (_ctx: unknown, fileIds: string[]) => {
      for (const id of fileIds) if (await fileIsRestricted(id)) refuse();
    },
    assertFileNotInRestrictedKnowledgeBase: async (_ctx: unknown, fileId: string) => {
      if (await fileIsRestricted(fileId)) refuse();
    },
    assertKnowledgeBaseBrowsable: async (_ctx: unknown, id: string) => {
      if (holder.restricted.has(id)) refuse();
    },
  };
});

const asyncCalls = vi.hoisted(() => ({ embeddingChunks: vi.fn(), parseFileToChunks: vi.fn() }));
vi.mock('@/server/routers/async', () => ({
  createAsyncCaller: async () => ({ file: asyncCalls }),
}));

const { getTestDB } = await import('@/database/core/getTestDB');
const {
  apiKeys,
  asyncTasks,
  chunks,
  embeddings,
  fileChunks,
  files,
  knowledgeBaseFiles,
  knowledgeBases,
  users,
  workspaceMembers,
  workspaces,
} = await import('@/database/schemas');
const { hashApiKey } = await import('@lobechat/utils/server');
const { HTTPException } = await import('hono/http-exception');
const { errorInitFromException, renderApiError } = await import('../common/errors');
const { userAuthMiddleware } = await import('../middleware/auth');
const { workspaceAuthMiddleware } = await import('../middleware/workspace');
const { FileSearchResultSchema, FileTaskAcceptedSchema, KnowledgeBaseSearchResultSchema } =
  await import('../types/retrieval.type');
const FileRoutes = (await import('./files.route')).default;
const KnowledgeBaseRoutes = (await import('./knowledge-bases.route')).default;

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
app.route('/files', FileRoutes);
app.route('/knowledge-bases', KnowledgeBaseRoutes);

const OWNER = 'r5-rag-owner';
const STRANGER = 'r5-rag-stranger';
const WORKSPACE = 'r5-rag-ws';

const KEYS = {
  fileRead: 'sk-lh-r5ragfileread001',
  fileWrite: 'sk-lh-r5ragfilewrite01',
  knowledgeRead: 'sk-lh-r5ragknowread001',
  stranger: 'sk-lh-r5ragstranger001',
  userOnly: 'sk-lh-r5raguseronly001',
  workspace: 'sk-lh-r5ragworkspace01',
} as const;

const FILE_DESIGN = 'file_r5design0001';
const FILE_CODE = 'file_r5code000001';
const FILE_STRANGER = 'file_r5stranger01';
const FILE_EMPTY = 'file_r5empty00001';
const KB = 'kb_r5owner000001';
const KB_STRANGER = 'kb_r5stranger001';

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
    method: init.method ?? 'POST',
  });

const json = async (res: Response) => (await res.json()) as any;

const file = (id: string, userId: string, name: string) => ({
  fileType: 'text/plain',
  id,
  name,
  size: 10,
  url: `files/${id}.txt`,
  userId,
});

/** One chunk with a fixed embedding, attached to `fileId`. */
const seedChunk = async (fileId: string, userId: string, text: string, vector: number[]) => {
  const [chunk] = await serverDB.insert(chunks).values({ index: 0, text, userId }).returning();
  await serverDB.insert(fileChunks).values({ chunkId: chunk.id, fileId, userId });
  await serverDB.insert(embeddings).values({ chunkId: chunk.id, embeddings: vector, userId });
  return chunk;
};

beforeEach(async () => {
  holder.embeddingsFail = undefined;
  holder.restricted.clear();
  asyncCalls.embeddingChunks.mockReset().mockResolvedValue(undefined);
  asyncCalls.parseFileToChunks.mockReset().mockResolvedValue(undefined);
  for (const table of [
    embeddings,
    fileChunks,
    chunks,
    knowledgeBaseFiles,
    knowledgeBases,
    files,
    asyncTasks,
    apiKeys,
    workspaceMembers,
    workspaces,
    users,
  ])
    await serverDB.delete(table);

  await serverDB.insert(users).values([{ id: OWNER }, { id: STRANGER }]);
  await serverDB
    .insert(workspaces)
    .values([{ id: WORKSPACE, name: 'R5 rag', primaryOwnerId: OWNER, slug: 'r5-rag' }]);
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
      key(KEYS.fileRead, OWNER, ['file:read']),
      key(KEYS.fileWrite, OWNER, ['file:write']),
      key(KEYS.knowledgeRead, OWNER, ['knowledge:read']),
      key(KEYS.stranger, STRANGER, ['file:read', 'file:write', 'knowledge:read']),
      key(KEYS.userOnly, OWNER, ['user:read']),
      key(KEYS.workspace, OWNER, ['file:read', 'knowledge:read'], WORKSPACE),
    ]);

  await serverDB
    .insert(files)
    .values([
      file(FILE_DESIGN, OWNER, 'design.txt'),
      file(FILE_CODE, OWNER, 'code.txt'),
      file(FILE_EMPTY, OWNER, 'empty.txt'),
      file(FILE_STRANGER, STRANGER, 'secret.txt'),
    ]);
  await seedChunk(FILE_DESIGN, OWNER, 'Design thinking starts with empathy', axis(0));
  await seedChunk(FILE_CODE, OWNER, 'Refactor the parser module', axis(1));
  await seedChunk(FILE_STRANGER, STRANGER, 'design secret of the stranger', axis(0));

  await serverDB.insert(knowledgeBases).values([
    { id: KB, name: 'Owner KB', userId: OWNER },
    { id: KB_STRANGER, name: 'Stranger KB', userId: STRANGER },
  ]);
  await serverDB.insert(knowledgeBaseFiles).values([
    { fileId: FILE_DESIGN, knowledgeBaseId: KB, userId: OWNER },
    { fileId: FILE_CODE, knowledgeBaseId: KB, userId: OWNER },
    { fileId: FILE_STRANGER, knowledgeBaseId: KB_STRANGER, userId: STRANGER },
  ]);
});

describe('POST /files/search', () => {
  it('ranks the chunks of the listed files by similarity and names their source file', async () => {
    const res = await call('/files/search', {
      body: { fileIds: [FILE_DESIGN, FILE_CODE], query: 'design thinking' },
      key: KEYS.fileRead,
    });

    expect(res.status).toBe(200);
    const { data } = await json(res);
    expect(FileSearchResultSchema.safeParse(data).success).toBe(true);
    expect(data.total).toBe(2);
    expect(data.chunks[0]).toMatchObject({
      fileId: FILE_DESIGN,
      fileName: 'design.txt',
      text: 'Design thinking starts with empathy',
    });
    expect(data.chunks[0].similarity).toBeCloseTo(1);
    expect(data.chunks[1].similarity).toBeCloseTo(0);
    expect(data.files[0]).toMatchObject({ fileId: FILE_DESIGN, fileName: 'design.txt' });
  });

  it('answers 401 without credentials', async () => {
    const res = await call('/files/search', { body: { fileIds: [FILE_DESIGN], query: 'x' } });

    expect(res.status).toBe(401);
  });

  it('refuses a key without file:read', async () => {
    const res = await call('/files/search', {
      body: { fileIds: [FILE_DESIGN], query: 'design' },
      key: KEYS.userOnly,
    });

    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('insufficient_scope');
  });

  it("answers 404 for another user's file instead of searching it", async () => {
    const res = await call('/files/search', {
      body: { fileIds: [FILE_STRANGER], query: 'design' },
      key: KEYS.fileRead,
    });

    expect(res.status).toBe(404);
    expect(JSON.stringify(await json(res))).not.toContain('design secret');
  });

  it('answers 404 for a personal file through a workspace-bound key', async () => {
    const res = await call('/files/search', {
      body: { fileIds: [FILE_DESIGN], query: 'design' },
      key: KEYS.workspace,
      workspaceId: WORKSPACE,
    });

    expect(res.status).toBe(404);
  });

  it('rejects an empty fileIds list and an empty query', async () => {
    expect(
      (await call('/files/search', { body: { fileIds: [], query: 'x' }, key: KEYS.fileRead }))
        .status,
    ).toBe(400);
    const res = await call('/files/search', {
      body: { fileIds: [FILE_DESIGN], query: '  ' },
      key: KEYS.fileRead,
    });
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe('validation_error');
  });

  it.each([
    [{ error: { message: 'boom' }, errorType: 'ProviderBizError' }, 502, 'upstream_error'],
    [
      { error: { message: 'Key disabled' }, errorType: 'InvalidProviderAPIKey' },
      401,
      'unauthorized',
    ],
    [{ error: 'Balance exhausted', errorType: 'InsufficientQuota' }, 429, 'rate_limited'],
  ])(
    'maps an embedding-provider rejection to an actionable status (%#)',
    async (rejection, status, code) => {
      holder.embeddingsFail = rejection;
      const res = await call('/files/search', {
        body: { fileIds: [FILE_DESIGN], query: 'design' },
        key: KEYS.fileRead,
      });

      expect(res.status).toBe(status);
      expect((await json(res)).code).toBe(code);
    },
  );

  it('answers 500 without internal detail when search fails outside the provider', async () => {
    holder.embeddingsFail = new Error('relation "embeddings" does not exist');
    const res = await call('/files/search', {
      body: { fileIds: [FILE_DESIGN], query: 'design' },
      key: KEYS.fileRead,
    });

    expect(res.status).toBe(500);
    expect(JSON.stringify(await json(res))).not.toContain('relation');
  });

  it('answers 403 when a file sits in a knowledge base restricted for the caller', async () => {
    holder.restricted.add(KB);
    const res = await call('/files/search', {
      body: { fileIds: [FILE_DESIGN], query: 'design' },
      key: KEYS.fileRead,
    });

    expect(res.status).toBe(403);
  });
});

describe('POST /knowledge-bases/{id}/search', () => {
  it('answers 403 for a knowledge base restricted for the caller', async () => {
    holder.restricted.add(KB);
    const res = await call(`/knowledge-bases/${KB}/search`, {
      body: { query: 'design' },
      key: KEYS.knowledgeRead,
    });

    expect(res.status).toBe(403);
  });

  it('searches only the files inside the knowledge base', async () => {
    const res = await call(`/knowledge-bases/${KB}/search`, {
      body: { query: 'design thinking', topK: 5 },
      key: KEYS.knowledgeRead,
    });

    expect(res.status).toBe(200);
    const { data } = await json(res);
    expect(KnowledgeBaseSearchResultSchema.safeParse(data).success).toBe(true);
    expect(data.chunks.map((chunk: any) => chunk.fileId).sort()).toEqual(
      [FILE_CODE, FILE_DESIGN].sort(),
    );
    expect(data.chunks[0].fileId).toBe(FILE_DESIGN);
    expect(JSON.stringify(data)).not.toContain('design secret');
  });

  it('refuses a key holding only file:read', async () => {
    const res = await call(`/knowledge-bases/${KB}/search`, {
      body: { query: 'design' },
      key: KEYS.fileRead,
    });

    expect(res.status).toBe(403);
  });

  it("answers 404 for another user's knowledge base", async () => {
    const res = await call(`/knowledge-bases/${KB_STRANGER}/search`, {
      body: { query: 'design' },
      key: KEYS.knowledgeRead,
    });

    expect(res.status).toBe(404);
  });

  it('answers 404 for a personal knowledge base through a workspace-bound key', async () => {
    const res = await call(`/knowledge-bases/${KB}/search`, {
      body: { query: 'design' },
      key: KEYS.workspace,
      workspaceId: WORKSPACE,
    });

    expect(res.status).toBe(404);
  });

  it('rejects topK above the cap and unknown fields', async () => {
    expect(
      (
        await call(`/knowledge-bases/${KB}/search`, {
          body: { query: 'design', topK: 500 },
          key: KEYS.knowledgeRead,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(`/knowledge-bases/${KB}/search`, {
          body: { fileIds: [FILE_STRANGER], query: 'design' },
          key: KEYS.knowledgeRead,
        })
      ).status,
    ).toBe(400);
  });
});

describe('POST /files/{id}/embeddings', () => {
  it('queues an embedding task for a parsed file and records it on the file', async () => {
    const res = await call(`/files/${FILE_DESIGN}/embeddings`, { key: KEYS.fileWrite });

    expect(res.status).toBe(202);
    const { data } = await json(res);
    expect(FileTaskAcceptedSchema.safeParse(data).success).toBe(true);
    expect(data).toMatchObject({ fileId: FILE_DESIGN, status: 'pending' });
    expect(asyncCalls.embeddingChunks).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: FILE_DESIGN, taskId: data.taskId }),
    );
    const row = await serverDB.query.files.findFirst({
      where: (t, { eq }) => eq(t.id, FILE_DESIGN),
    });
    expect(row?.embeddingTaskId).toBe(data.taskId);
  });

  it('answers 409 for a file that has no chunks yet', async () => {
    const res = await call(`/files/${FILE_EMPTY}/embeddings`, { key: KEYS.fileWrite });

    expect(res.status).toBe(409);
    expect(asyncCalls.embeddingChunks).not.toHaveBeenCalled();
  });

  it('refuses a read-only key', async () => {
    const res = await call(`/files/${FILE_DESIGN}/embeddings`, { key: KEYS.fileRead });

    expect(res.status).toBe(403);
    expect(asyncCalls.embeddingChunks).not.toHaveBeenCalled();
  });

  it("answers 404 for another user's file", async () => {
    const res = await call(`/files/${FILE_DESIGN}/embeddings`, { key: KEYS.stranger });

    expect(res.status).toBe(404);
    expect(asyncCalls.embeddingChunks).not.toHaveBeenCalled();
  });
});

describe('POST /files/{id}/parses/retry', () => {
  it('replaces the previous chunking task with a new one', async () => {
    const [previous] = await serverDB
      .insert(asyncTasks)
      .values({ status: 'error', type: 'chunk', userId: OWNER })
      .returning();
    await serverDB
      .update(files)
      .set({ chunkTaskId: previous.id })
      .where((await import('drizzle-orm')).eq(files.id, FILE_CODE));

    const res = await call(`/files/${FILE_CODE}/parses/retry`, { key: KEYS.fileWrite });

    expect(res.status).toBe(202);
    const { data } = await json(res);
    expect(FileTaskAcceptedSchema.safeParse(data).success).toBe(true);
    expect(data.taskId).not.toBe(previous.id);
    expect(data.status).toBe('processing');
    expect(asyncCalls.parseFileToChunks).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: FILE_CODE, taskId: data.taskId }),
    );
    expect(
      await serverDB.query.asyncTasks.findFirst({
        where: (t, { eq }) => eq(t.id, previous.id),
      }),
    ).toBeUndefined();
  });

  it('answers 422 for a file type that cannot be chunked and keeps its previous task', async () => {
    const [previous] = await serverDB
      .insert(asyncTasks)
      .values({ status: 'error', type: 'chunk', userId: OWNER })
      .returning();
    await serverDB
      .insert(files)
      .values({ ...file('file_r5drawing001', OWNER, 'plan.dwg'), chunkTaskId: previous.id });

    const res = await call('/files/file_r5drawing001/parses/retry', { key: KEYS.fileWrite });

    expect(res.status).toBe(422);
    expect((await json(res)).message).toContain('plan.dwg');
    expect(
      await serverDB.query.asyncTasks.findFirst({ where: (t, { eq }) => eq(t.id, previous.id) }),
    ).toBeDefined();
    expect(asyncCalls.parseFileToChunks).not.toHaveBeenCalled();
  });

  it('answers 403 for a file in a restricted knowledge base, for embedding too', async () => {
    holder.restricted.add(KB);

    expect((await call(`/files/${FILE_CODE}/parses/retry`, { key: KEYS.fileWrite })).status).toBe(
      403,
    );
    expect((await call(`/files/${FILE_DESIGN}/embeddings`, { key: KEYS.fileWrite })).status).toBe(
      403,
    );
    expect(asyncCalls.parseFileToChunks).not.toHaveBeenCalled();
    expect(asyncCalls.embeddingChunks).not.toHaveBeenCalled();
  });

  it("answers 404 for another user's file and 403 for a read-only key", async () => {
    expect((await call(`/files/${FILE_CODE}/parses/retry`, { key: KEYS.stranger })).status).toBe(
      404,
    );
    expect((await call(`/files/${FILE_CODE}/parses/retry`, { key: KEYS.fileRead })).status).toBe(
      403,
    );
    expect(asyncCalls.parseFileToChunks).not.toHaveBeenCalled();
  });
});
