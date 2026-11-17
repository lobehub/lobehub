// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Memory writes and retrieval over real HTTP: `POST/PATCH /memories/{category}`,
 * `POST /memories/search`, `POST /memories/extractions` and
 * `POST /memories/persona/versions/{id}/restore`, behind the auth + workspace
 * middlewares `app.ts` mounts, the real scope gates, controller, REST service
 * and the `userMemory` / `userMemories` tRPC procedures it calls, on PGlite.
 * API keys are real `api_keys` rows. Only the edges that leave the process are
 * stubbed: the embedding provider and the extraction workflow trigger.
 */
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');

const DIM = 1024;
const axis = (index: number) => Array.from({ length: DIM }, (_, i) => (i === index ? 1 : 0));

// PGlite has no ParadeDB: run the keyword half of memory search on plain ILIKE.
vi.hoisted(() => vi.stubEnv('FTS_SEARCH_PROVIDER', 'pg_like'));

const holder = vi.hoisted(() => ({
  /** What the embedding provider rejects with, when set. */
  embeddingsFail: undefined as unknown,
  serverDB: undefined as unknown,
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => holder.serverDB,
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: async () => ({
    // Texts mentioning "coffee" land on axis 0, anything else on axis 1.
    embeddings: async ({ input }: { input: string | string[] }) => {
      if (holder.embeddingsFail) throw holder.embeddingsFail;
      const texts = Array.isArray(input) ? input : [input];
      return texts.map((text) => axis(/coffee/i.test(text) ? 0 : 1));
    },
  }),
}));

const workflow = vi.hoisted(() => ({ triggerProcessUsers: vi.fn() }));
vi.mock('@/server/services/memory/userMemory/extract', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  MemoryExtractionWorkflowService: workflow,
}));

const { getTestDB } = await import('@/database/core/getTestDB');
const { eq } = await import('drizzle-orm');
const {
  apiKeys,
  asyncTasks,
  messages,
  topics,
  userMemories,
  userMemoriesActivities,
  userMemoriesContexts,
  userMemoriesExperiences,
  userMemoriesIdentities,
  userMemoriesPreferences,
  userPersonaDocumentHistories,
  userPersonaDocuments,
  users,
  workspaceMembers,
  workspaces,
} = await import('@/database/schemas');
const { UserPersonaModel } = await import('@/database/models/userMemory/persona');
const { hashApiKey } = await import('@lobechat/utils/server');
const { HTTPException } = await import('hono/http-exception');
const { errorInitFromException, renderApiError } = await import('../common/errors');
const { userAuthMiddleware } = await import('../middleware/auth');
const { workspaceAuthMiddleware } = await import('../middleware/workspace');
const { MemoryExtractionTaskSchema, MemorySearchResultSchema, RestoredPersonaSchema } =
  await import('../types/memory-write.type');
const { MemoryIdentitySchema, MemoryPreferenceSchema } = await import('../types/memory.type');
const MemoryRoutes = (await import('./memories.route')).default;

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
app.route('/memories', MemoryRoutes);

const OWNER = 'r5-mem-owner';
const STRANGER = 'r5-mem-stranger';
const WORKSPACE = 'r5-mem-ws';

const KEYS = {
  chatOnly: 'sk-lh-r5memchatonly000',
  extract: 'sk-lh-r5memextract0000',
  read: 'sk-lh-r5memreadonly000',
  stranger: 'sk-lh-r5memstranger000',
  workspace: 'sk-lh-r5memworkspace00',
  write: 'sk-lh-r5memwriter00001',
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
    method: init.method ?? 'POST',
  });

const json = async (res: Response) => (await res.json()) as any;

const identityBody = {
  description: 'Drinks a flat white every morning before standup',
  relationship: 'self',
  role: 'Engineer',
  summary: 'The user loves coffee',
  tags: ['coffee'],
  title: 'Coffee lover',
};

const preferenceBody = {
  conclusionDirectives: 'Answer in short bullet points',
  summary: 'Prefers terse answers',
  title: 'Terse answers',
};

const createIdentity = async (key: string = KEYS.write) => {
  const res = await call('/memories/identities', { body: identityBody, key });
  expect(res.status).toBe(201);
  return (await json(res)).data;
};

beforeEach(async () => {
  holder.embeddingsFail = undefined;
  workflow.triggerProcessUsers.mockReset().mockResolvedValue({ workflowRunId: 'wfr_1' });
  for (const table of [
    userMemoriesActivities,
    userMemoriesContexts,
    userMemoriesExperiences,
    userMemoriesIdentities,
    userMemoriesPreferences,
    userMemories,
    userPersonaDocumentHistories,
    userPersonaDocuments,
    messages,
    topics,
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
    .values([{ id: WORKSPACE, name: 'R5 mem', primaryOwnerId: OWNER, slug: 'r5-mem' }]);
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
      key(KEYS.chatOnly, OWNER, ['chat:write']),
      key(KEYS.extract, OWNER, ['user:read', 'user:write', 'model:invoke']),
      key(KEYS.read, OWNER, ['user:read']),
      key(KEYS.stranger, STRANGER, ['user:read', 'user:write']),
      key(KEYS.workspace, OWNER, ['user:read', 'user:write'], WORKSPACE),
      key(KEYS.write, OWNER, ['user:read', 'user:write']),
    ]);
});

describe('POST /memories/{category}', () => {
  it('writes an identity, embeds it and answers with the stored entry', async () => {
    const entry = await createIdentity();

    expect(MemoryIdentitySchema.safeParse(entry).success).toBe(true);
    expect(entry).toMatchObject({
      description: identityBody.description,
      relationship: 'self',
      role: 'Engineer',
    });
    expect(entry).not.toHaveProperty('descriptionVector');

    const [row] = await serverDB
      .select()
      .from(userMemoriesIdentities)
      .where(eq(userMemoriesIdentities.id, entry.id));
    expect(row.userId).toBe(OWNER);
    expect(row.descriptionVector).toHaveLength(DIM);
  });

  it('writes a preference', async () => {
    const res = await call('/memories/preferences', { body: preferenceBody, key: KEYS.write });

    expect(res.status).toBe(201);
    const { data } = await json(res);
    expect(MemoryPreferenceSchema.safeParse(data).success).toBe(true);
    expect(data.conclusionDirectives).toBe(preferenceBody.conclusionDirectives);
  });

  it.each([
    [
      'contexts',
      {
        description: 'Migrating the billing service',
        summary: 'Billing migration',
        title: 'Billing',
      },
      'description',
    ],
    [
      'activities',
      { narrative: 'Met the design team about onboarding', summary: 'Design sync', title: 'Sync' },
      'narrative',
    ],
    [
      'experiences',
      { situation: 'Flaky CI on Fridays', summary: 'Pin the runner image', title: 'CI lesson' },
      'situation',
    ],
  ])('writes a %s entry and reads it back', async (category, body, field) => {
    const res = await call(`/memories/${category}`, { body, key: KEYS.write });

    expect(res.status).toBe(201);
    const { data } = await json(res);
    expect(typeof data.id).toBe('string');
    expect(data[field]).toBe((body as Record<string, string>)[field]);
    expect(Object.keys(data).some((key) => key.endsWith('Vector'))).toBe(false);
  });

  it("writes the user's personal memory through a workspace-bound key", async () => {
    const res = await call('/memories/identities', {
      body: identityBody,
      key: KEYS.workspace,
      workspaceId: WORKSPACE,
    });

    expect(res.status).toBe(201);
    const { data } = await json(res);
    const found = await json(
      await call('/memories/search', { body: { queries: ['coffee'] }, key: KEYS.read }),
    );
    expect(found.data.identities.map((item: { id: string }) => item.id)).toContain(data.id);
  });

  it('answers 500 with a generic code and hides the raw write failure', async () => {
    // The shared write procedures report failures as `{ success: false, message }`
    // where the message is raw provider / database text; the REST layer must log it
    // and answer a generic `internal_error` instead.
    holder.embeddingsFail = new Error('embedding provider rejected: sk-lh-internal-7f3a');
    const res = await call('/memories/identities', { body: identityBody, key: KEYS.write });

    expect(res.status).toBe(500);
    const body = await json(res);
    expect(body.code).toBe('internal_error');
    expect(JSON.stringify(body)).not.toContain('sk-lh-internal-7f3a');
    await expect(serverDB.select().from(userMemoriesIdentities)).resolves.toHaveLength(0);
  });

  it('answers 401 without a key', async () => {
    expect((await call('/memories/identities', { body: identityBody })).status).toBe(401);
  });

  it('refuses a read-only key and a chat-only key', async () => {
    for (const key of [KEYS.read, KEYS.chatOnly]) {
      const res = await call('/memories/identities', { body: identityBody, key });
      expect(res.status).toBe(403);
    }
    expect(await serverDB.select().from(userMemoriesIdentities)).toHaveLength(0);
  });

  it('rejects a missing title and unknown fields', async () => {
    const { title: _title, ...noTitle } = identityBody;
    expect((await call('/memories/identities', { body: noTitle, key: KEYS.write })).status).toBe(
      400,
    );
    expect(
      (
        await call('/memories/identities', {
          body: { ...identityBody, userId: STRANGER },
          key: KEYS.write,
        })
      ).status,
    ).toBe(400);
  });
});

describe('PATCH /memories/{category}/{id}', () => {
  it('updates the caller’s own entry', async () => {
    const entry = await createIdentity();

    const res = await call(`/memories/identities/${entry.id}`, {
      body: { role: 'Staff engineer' },
      key: KEYS.write,
      method: 'PATCH',
    });

    expect(res.status).toBe(200);
    const { data } = await json(res);
    expect(data).toMatchObject({ id: entry.id, role: 'Staff engineer' });
  });

  it("answers 404 for another user's entry and leaves it untouched", async () => {
    const entry = await createIdentity();

    const res = await call(`/memories/identities/${entry.id}`, {
      body: { role: 'Hijacked' },
      key: KEYS.stranger,
      method: 'PATCH',
    });

    expect(res.status).toBe(404);
    const [row] = await serverDB
      .select()
      .from(userMemoriesIdentities)
      .where(eq(userMemoriesIdentities.id, entry.id));
    expect(row.role).toBe('Engineer');
  });

  it('rejects an empty patch and refuses a read-only key', async () => {
    const entry = await createIdentity();
    const path = `/memories/identities/${entry.id}`;

    expect((await call(path, { body: {}, key: KEYS.write, method: 'PATCH' })).status).toBe(400);
    expect(
      (await call(path, { body: { role: 'x' }, key: KEYS.read, method: 'PATCH' })).status,
    ).toBe(403);
  });
});

describe('POST /memories/search', () => {
  it('finds the written memory by meaning and never echoes the owner', async () => {
    const entry = await createIdentity();
    await call('/memories/preferences', { body: preferenceBody, key: KEYS.write });

    const res = await call('/memories/search', {
      body: { layers: ['identity'], queries: ['what coffee does the user drink'] },
      key: KEYS.read,
    });

    expect(res.status).toBe(200);
    const { data } = await json(res);
    expect(MemorySearchResultSchema.safeParse(data).success).toBe(true);
    expect(data.identities.map((item: { id: string }) => item.id)).toContain(entry.id);
    expect(data.identities[0]).not.toHaveProperty('userId');
  });

  it('searches the same personal memory through a workspace-bound key', async () => {
    const entry = await createIdentity();

    const res = await call('/memories/search', {
      body: { queries: ['coffee'] },
      key: KEYS.workspace,
      workspaceId: WORKSPACE,
    });

    expect(res.status).toBe(200);
    expect((await json(res)).data.identities.map((item: { id: string }) => item.id)).toContain(
      entry.id,
    );
  });

  it("does not return another user's memories", async () => {
    await createIdentity();

    const res = await call('/memories/search', {
      body: { queries: ['coffee'] },
      key: KEYS.stranger,
    });

    expect(res.status).toBe(200);
    const { data } = await json(res);
    expect(data.identities).toEqual([]);
  });

  it("answers 404 for another user's topic", async () => {
    await serverDB.insert(topics).values({ id: 'tpc_r5stranger', title: 'x', userId: STRANGER });

    const res = await call('/memories/search', {
      body: { topicId: 'tpc_r5stranger' },
      key: KEYS.read,
    });

    expect(res.status).toBe(404);
  });

  it('requires exactly one of queries and topicId, and user:read', async () => {
    expect((await call('/memories/search', { body: {}, key: KEYS.read })).status).toBe(400);
    expect(
      (
        await call('/memories/search', {
          body: { queries: ['a'], topicId: 'tpc_1' },
          key: KEYS.read,
        })
      ).status,
    ).toBe(400);
    expect(
      (await call('/memories/search', { body: { queries: ['a'] }, key: KEYS.chatOnly })).status,
    ).toBe(403);
  });
});

describe('POST /memories/extractions', () => {
  it('queues an extraction over the caller’s topics and dedupes a second request', async () => {
    await serverDB.insert(topics).values({ id: 'tpc_r5owner01', title: 'Coffee', userId: OWNER });

    const res = await call('/memories/extractions', { body: {}, key: KEYS.extract });

    expect(res.status).toBe(202);
    const { data } = await json(res);
    expect(MemoryExtractionTaskSchema.safeParse(data).success).toBe(true);
    expect(data).toMatchObject({ deduped: false, progress: { totalTopics: 1 }, status: 'pending' });
    expect(workflow.triggerProcessUsers).toHaveBeenCalledTimes(1);

    const again = await json(await call('/memories/extractions', { body: {}, key: KEYS.extract }));
    expect(again.data).toMatchObject({ deduped: true, id: data.id });
    expect(workflow.triggerProcessUsers).toHaveBeenCalledTimes(1);

    const polled = await call(`/memories/extractions/${data.id}`, {
      key: KEYS.read,
      method: 'GET',
    });
    expect(polled.status).toBe(200);
    expect((await json(polled)).data.id).toBe(data.id);
  });

  it('needs model:invoke on top of user:write', async () => {
    const res = await call('/memories/extractions', { body: {}, key: KEYS.write });

    expect(res.status).toBe(403);
    expect(workflow.triggerProcessUsers).not.toHaveBeenCalled();
  });

  it("answers 404 when polling another user's task", async () => {
    const { data } = await json(
      await call('/memories/extractions', { body: {}, key: KEYS.extract }),
    );

    const res = await call(`/memories/extractions/${data.id}`, {
      key: KEYS.stranger,
      method: 'GET',
    });
    expect(res.status).toBe(404);
  });

  it('rejects an invalid date and fromDate after toDate', async () => {
    expect(
      (await call('/memories/extractions', { body: { fromDate: 'nope' }, key: KEYS.extract }))
        .status,
    ).toBe(400);
    expect(
      (
        await call('/memories/extractions', {
          body: { fromDate: '2026-02-01T00:00:00Z', toDate: '2026-01-01T00:00:00Z' },
          key: KEYS.extract,
        })
      ).status,
    ).toBe(400);
  });
});

describe('POST /memories/persona/versions/{id}/restore', () => {
  const seedVersions = async () => {
    const persona = new UserPersonaModel(serverDB as any, OWNER);
    await persona.upsertPersona({
      editedBy: 'agent',
      persona: 'Version one',
      snapshot: 'Version one',
      tagline: 'v1',
    });
    await persona.upsertPersona({
      editedBy: 'agent',
      persona: 'Version two',
      snapshot: 'Version two',
      tagline: 'v2',
    });
    const versions = await persona.listVersions();
    const first = versions.find((version) => version.snapshotPersona === 'Version one');
    expect(first).toBeDefined();
    return first!.id;
  };

  it('makes the earlier version current again', async () => {
    const historyId = await seedVersions();

    const res = await call(`/memories/persona/versions/${historyId}/restore`, { key: KEYS.write });

    expect(res.status).toBe(200);
    const { data } = await json(res);
    expect(RestoredPersonaSchema.safeParse(data).success).toBe(true);
    expect(data).toMatchObject({ historyId, persona: { content: 'Version one', summary: 'v1' } });
  });

  it("answers 404 for another user's version", async () => {
    const historyId = await seedVersions();

    const res = await call(`/memories/persona/versions/${historyId}/restore`, {
      key: KEYS.stranger,
    });
    expect(res.status).toBe(404);
  });

  it('answers 403 through a workspace-bound key and for a read-only key', async () => {
    const historyId = await seedVersions();
    const path = `/memories/persona/versions/${historyId}/restore`;

    expect((await call(path, { key: KEYS.workspace, workspaceId: WORKSPACE })).status).toBe(403);
    expect((await call(path, { key: KEYS.read })).status).toBe(403);
  });
});
