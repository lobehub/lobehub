// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/api/v1/images/generations`, `/api/v1/videos/generations` and
 * `/api/v1/generations` over real HTTP: real routes behind the `app.ts` auth
 * and workspace middlewares, real permission/scope gates, controller, REST
 * service, generation model and the shared `generationTopic` / `generation`
 * procedures, on PGlite. API keys are real `api_keys` rows.
 *
 * Only the paid model calls are faked: `image.createImage` / `video.createVideo`
 * write the batch, async task and generation rows the real procedures write,
 * without reaching a provider. Storage URLs come from a fake FileService.
 */
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');

const holder = vi.hoisted(() => ({
  createCalls: [] as { ctx: any; input: any; kind: 'image' | 'video' }[],
  serverDB: undefined as unknown,
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => holder.serverDB,
}));

vi.mock('@/server/services/file', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  FileService: class {
    deleteFile = async () => {};
    deleteFiles = async () => {};
    getFileAccessUrl = async ({ url }: { url: string }) => `https://cdn.test/${url}`;
    getFullFileUrl = async (key: string) => `https://cdn.test/${key}`;
    getKeyFromFullUrl = async (url: string) => url;
  },
}));

/**
 * Writes what the real create procedures write. Prompts containing "instant"
 * finish at once; "broke" is refused by the budget check, which (like the cloud
 * `chargeBeforeGenerate`) records generations that already failed; "reject" is
 * refused outright, as an unsupported parameter is.
 */
const fakeCreate = async (kind: 'image' | 'video', ctx: any, input: any) => {
  holder.createCalls.push({ ctx, input, kind });
  if (String(input.params.prompt).includes('reject')) {
    const { TRPCError } = await import('@trpc/server');
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unsupported parameters for model' });
  }
  const { asyncTasks, generationBatches, generations } = await import('@/database/schemas');
  const db = holder.serverDB as any;
  const owner = { userId: ctx.userId, workspaceId: ctx.workspaceId ?? null };
  const [batch] = await db
    .insert(generationBatches)
    .values({
      ...owner,
      config: input.params,
      generationTopicId: input.generationTopicId,
      model: input.model ?? 'default-image-model',
      prompt: input.params.prompt,
      provider: input.provider ?? 'default-provider',
    })
    .returning();

  const instant = String(input.params.prompt).includes('instant');
  const broke = String(input.params.prompt).includes('broke');
  const created = [];
  for (let i = 0; i < (input.imageNum ?? 1); i++) {
    const [task] = await db
      .insert(asyncTasks)
      .values({
        ...owner,
        ...(broke
          ? {
              error: { body: { detail: 'Not enough credits' }, name: 'InsufficientBudget' },
              status: 'error',
            }
          : { status: instant ? 'success' : 'pending' }),
        type: kind,
      })
      .returning();
    const [generation] = await db
      .insert(generations)
      .values({
        ...owner,
        asset: instant
          ? { height: 512, thumbnailUrl: `thumb-${i}.webp`, url: `image-${i}.png`, width: 512 }
          : null,
        asyncTaskId: task.id,
        generationBatchId: batch.id,
        seed: 7 + i,
      })
      .returning();
    created.push({ ...generation, asyncTaskId: task.id });
  }
  return { data: { batch, generations: created }, success: true };
};

vi.mock('@/server/routers/lambda/image', () => ({
  imageRouter: {
    createCaller: (ctx: any) => ({ createImage: (input: any) => fakeCreate('image', ctx, input) }),
  },
}));
vi.mock('@/server/routers/lambda/video', () => ({
  videoRouter: {
    createCaller: (ctx: any) => ({ createVideo: (input: any) => fakeCreate('video', ctx, input) }),
  },
}));

const { getTestDB } = await import('@/database/core/getTestDB');
const {
  apiKeys,
  asyncTasks,
  generationBatches,
  generations,
  generationTopics,
  users,
  workspaceMembers,
  workspaces,
} = await import('@/database/schemas');
const { eq } = await import('drizzle-orm');
const { hashApiKey } = await import('@lobechat/utils/server');
const { HTTPException } = await import('hono/http-exception');
const { errorInitFromException, renderApiError } = await import('../common/errors');
const { userAuthMiddleware } = await import('../middleware/auth');
const { workspaceAuthMiddleware } = await import('../middleware/workspace');
const { GenerationBatchCreatedSchema, GenerationListResponseSchema, GenerationSchema } =
  await import('../types/generation.type');
const { DeletedResourceSchema } = await import('../types/common.type');
const GenerationRoutes = (await import('./generations.route')).default;
const ImageRoutes = (await import('./images.route')).default;
const VideoRoutes = (await import('./videos.route')).default;

const serverDB = await getTestDB();
holder.serverDB = serverDB;

const app = new Hono().basePath('/api/v1');
// The same error rendering `app.ts` installs, so middleware refusals carry their code.
app.onError((error, c) =>
  error instanceof HTTPException
    ? renderApiError(c, errorInitFromException(error))
    : renderApiError(c, { message: error.message, status: 500 }),
);
app.use('*', userAuthMiddleware);
app.use('*', workspaceAuthMiddleware);
app.route('/generations', GenerationRoutes);
app.route('/images', ImageRoutes);
app.route('/videos', VideoRoutes);

const OWNER = 'r6-gen-owner';
const STRANGER = 'r6-gen-stranger';
const WORKSPACE = 'r6-gen-ws';
const OTHER_WORKSPACE = 'r6-gen-other-ws';

const KEYS = {
  chatOnly: 'sk-lh-r6genchatonly001',
  ownerRead: 'sk-lh-r6genownerread01',
  ownerWrite: 'sk-lh-r6genownerwrite1',
  stranger: 'sk-lh-r6genstranger001',
  workspace: 'sk-lh-r6genworkspace01',
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

const generateImages = async (body: Record<string, unknown>, key: string = KEYS.ownerWrite) => {
  const res = await call('/images/generations', { body, key, method: 'POST' });
  expect(res.status).toBe(200);
  return GenerationBatchCreatedSchema.parse((await json(res)).data);
};

beforeEach(async () => {
  holder.createCalls.length = 0;
  await serverDB.delete(generations);
  await serverDB.delete(generationBatches);
  await serverDB.delete(generationTopics);
  await serverDB.delete(asyncTasks);
  await serverDB.delete(apiKeys);
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: OWNER }, { id: STRANGER }]);
  await serverDB.insert(workspaces).values([
    { id: WORKSPACE, name: 'R6 generations', primaryOwnerId: OWNER, slug: 'r6-gen' },
    { id: OTHER_WORKSPACE, name: 'R6 other', primaryOwnerId: STRANGER, slug: 'r6-other' },
  ]);
  await serverDB.insert(workspaceMembers).values([
    { role: 'owner', userId: OWNER, workspaceId: WORKSPACE },
    { role: 'owner', userId: STRANGER, workspaceId: OTHER_WORKSPACE },
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
      key(KEYS.ownerWrite, OWNER, ['generation:write']),
      key(KEYS.ownerRead, OWNER, ['generation:read']),
      key(KEYS.chatOnly, OWNER, ['chat:write', 'model:invoke']),
      key(KEYS.stranger, STRANGER, ['generation:write']),
      key(KEYS.workspace, OWNER, ['generation:write'], WORKSPACE),
    ]);
});

describe('authentication and API-key scopes', () => {
  it('answers 401 without credentials on every endpoint', async () => {
    const responses = await Promise.all([
      call('/generations'),
      call('/generations/gen_x'),
      call('/generations/gen_x', { method: 'DELETE' }),
      call('/images/generations', { body: { prompt: 'a cat' }, method: 'POST' }),
      call('/videos/generations', {
        body: { model: 'm', prompt: 'a cat', provider: 'p' },
        method: 'POST',
      }),
    ]);

    for (const res of responses) {
      expect(res.status).toBe(401);
      expect((await json(res)).code).toBe('unauthorized');
    }
  });

  it('refuses a key without a generation scope, even one holding model:invoke', async () => {
    const responses = await Promise.all([
      call('/generations', { key: KEYS.chatOnly }),
      call('/generations/gen_x', { key: KEYS.chatOnly }),
      call('/images/generations', {
        body: { prompt: 'a cat' },
        key: KEYS.chatOnly,
        method: 'POST',
      }),
    ]);

    for (const res of responses) {
      expect(res.status).toBe(403);
      expect((await json(res)).code).toBe('insufficient_scope');
    }
    expect(holder.createCalls).toEqual([]);
  });

  it('lets a generation:read key read but not generate or delete', async () => {
    const { generations: created } = await generateImages({ prompt: 'instant fox' });

    expect((await call('/generations', { key: KEYS.ownerRead })).status).toBe(200);
    expect((await call(`/generations/${created[0].id}`, { key: KEYS.ownerRead })).status).toBe(200);

    const refused = await Promise.all([
      call('/images/generations', { body: { prompt: 'x' }, key: KEYS.ownerRead, method: 'POST' }),
      call('/videos/generations', {
        body: { model: 'm', prompt: 'x', provider: 'p' },
        key: KEYS.ownerRead,
        method: 'POST',
      }),
      call(`/generations/${created[0].id}`, { key: KEYS.ownerRead, method: 'DELETE' }),
    ]);
    for (const res of refused) {
      expect(res.status).toBe(403);
      expect((await json(res)).code).toBe('insufficient_scope');
    }
  });
});

describe('request validation', () => {
  it('rejects bad image requests before anything is generated', async () => {
    const bodies = [
      {},
      { prompt: '   ' },
      { n: 9, prompt: 'a cat' },
      { prompt: 'a cat', waitTimeoutSeconds: 600 },
      { imageUrls: ['not a url'], prompt: 'a cat' },
      { prompt: 'a cat', unknownField: true },
    ];

    for (const body of bodies) {
      const res = await call('/images/generations', {
        body,
        key: KEYS.ownerWrite,
        method: 'POST',
      });
      expect(res.status).toBe(400);
      expect((await json(res)).code).toBe('validation_error');
    }
    expect(holder.createCalls).toEqual([]);
  });

  it('requires a video model and provider', async () => {
    for (const body of [{ prompt: 'waves' }, { model: 'm', prompt: 'waves' }, { provider: 'p' }]) {
      const res = await call('/videos/generations', {
        body,
        key: KEYS.ownerWrite,
        method: 'POST',
      });
      expect(res.status).toBe(400);
      expect((await json(res)).code).toBe('validation_error');
    }
    expect(holder.createCalls).toEqual([]);
  });

  it('validates list paging and filters', async () => {
    for (const query of ['limit=0', 'limit=101', 'type=audio', 'cursor=bogus']) {
      const res = await call(`/generations?${query}`, { key: KEYS.ownerRead });
      expect(res.status).toBe(400);
      expect((await json(res)).code).toBe('validation_error');
    }
  });

  it('refuses a topic of another kind', async () => {
    const video = await call('/videos/generations', {
      body: { model: 'seedance', prompt: 'waves', provider: 'volcengine' },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    const { topicId } = (await json(video)).data;

    const res = await call('/images/generations', {
      body: { prompt: 'a cat', topicId },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(res.status).toBe(400);
    expect((await json(res)).details).toEqual([
      { message: 'Expected a image topic', path: 'body.topicId' },
    ]);
  });
});

describe('image generation', () => {
  it('waits for the images and returns them with their URLs', async () => {
    const created = await generateImages({
      model: 'gpt-image-1',
      n: 2,
      params: { quality: 'high' },
      prompt: 'instant lighthouse at dawn',
      provider: 'openai',
      width: 1024,
    });

    expect(created.generations).toHaveLength(2);
    expect(created.generations[0]).toMatchObject({
      asset: {
        height: 512,
        thumbnailUrl: 'https://cdn.test/thumb-0.webp',
        url: 'https://cdn.test/image-0.png',
        width: 512,
      },
      batchId: created.batchId,
      error: null,
      model: 'gpt-image-1',
      prompt: 'instant lighthouse at dawn',
      provider: 'openai',
      status: 'success',
      topicId: created.topicId,
      type: 'image',
    });

    // The shared procedure got the REST fields in its own shape.
    const [{ ctx, input }] = holder.createCalls;
    expect(ctx).toEqual({
      spendOrigin: { trigger: 'api' },
      userId: OWNER,
      workspaceId: undefined,
    });
    expect(input).toEqual({
      generationTopicId: created.topicId,
      imageNum: 2,
      model: 'gpt-image-1',
      params: { prompt: 'instant lighthouse at dawn', quality: 'high', width: 1024 },
      provider: 'openai',
    });

    // A new topic named after the prompt holds the request, as on the Image page.
    const [topic] = await serverDB
      .select()
      .from(generationTopics)
      .where(eq(generationTopics.id, created.topicId));
    expect(topic).toMatchObject({
      title: 'instant lighthouse at dawn',
      type: 'image',
      userId: OWNER,
    });
  });

  it('answers with pending generations when not waiting, then reports them by id', async () => {
    const created = await generateImages({ prompt: 'slow watercolor', wait: false });
    const [generation] = created.generations;
    expect(generation).toMatchObject({ asset: null, status: 'pending', type: 'image' });

    const res = await call(`/generations/${generation.id}`, { key: KEYS.ownerRead });
    expect(res.status).toBe(200);
    expect(GenerationSchema.parse((await json(res)).data)).toEqual(generation);
  });

  it('reports a budget refusal as failed generations, not an HTTP error', async () => {
    const created = await generateImages({ n: 2, prompt: 'broke cat' });

    expect(created.generations).toHaveLength(2);
    for (const generation of created.generations) {
      expect(generation).toMatchObject({
        asset: null,
        error: { message: 'Not enough credits', name: 'InsufficientBudget' },
        status: 'error',
      });
    }
  });

  it('removes the topic it created when the request is refused', async () => {
    const res = await call('/images/generations', {
      body: { prompt: 'reject this' },
      key: KEYS.ownerWrite,
      method: 'POST',
    });

    expect(res.status).toBe(400);
    expect((await json(res)).message).toBe('Unsupported parameters for model');
    expect(await serverDB.select().from(generationTopics)).toEqual([]);

    // A caller's own topic stays.
    const { topicId } = await generateImages({ prompt: 'instant keep' });
    const again = await call('/images/generations', {
      body: { prompt: 'reject again', topicId },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(again.status).toBe(400);
    expect((await serverDB.select().from(generationTopics)).map((topic) => topic.id)).toEqual([
      topicId,
    ]);
  });

  it('adds a request to an existing topic of the caller', async () => {
    const first = await generateImages({ prompt: 'instant one' });
    const second = await generateImages({ prompt: 'instant two', topicId: first.topicId });

    expect(second.topicId).toBe(first.topicId);
    expect(await serverDB.select().from(generationTopics)).toHaveLength(1);
  });
});

describe('video generation', () => {
  it('answers 202 with the pending generation id', async () => {
    const res = await call('/videos/generations', {
      body: {
        aspectRatio: '16:9',
        duration: 5,
        model: 'seedance-1-0-pro',
        prompt: 'waves at sunset',
        provider: 'volcengine',
      },
      key: KEYS.ownerWrite,
      method: 'POST',
    });

    expect(res.status).toBe(202);
    const created = GenerationBatchCreatedSchema.parse((await json(res)).data);
    expect(created.generations).toEqual([
      expect.objectContaining({ asset: null, status: 'pending', type: 'video' }),
    ]);
    expect(holder.createCalls[0].input.params).toEqual({
      aspectRatio: '16:9',
      duration: 5,
      prompt: 'waves at sunset',
    });

    const status = await call(`/generations/${created.generations[0].id}`, {
      key: KEYS.ownerRead,
    });
    expect((await json(status)).data).toMatchObject({ status: 'pending', type: 'video' });
  });
});

describe('listing and deleting', () => {
  it('pages newest first and filters by kind', async () => {
    await generateImages({ n: 3, prompt: 'instant set' });
    await call('/videos/generations', {
      body: { model: 'm', prompt: 'a video', provider: 'p' },
      key: KEYS.ownerWrite,
      method: 'POST',
    });

    const first = GenerationListResponseSchema.parse(
      (await json(await call('/generations?limit=3', { key: KEYS.ownerRead }))).data,
    );
    expect(first.total).toBe(4);
    expect(first.items).toHaveLength(3);
    expect(first.hasMore).toBe(true);

    const rest = GenerationListResponseSchema.parse(
      (
        await json(
          await call(`/generations?limit=3&cursor=${first.nextCursor}`, { key: KEYS.ownerRead }),
        )
      ).data,
    );
    expect(rest).toMatchObject({ hasMore: false, nextCursor: null, total: 4 });
    expect(rest.items).toHaveLength(1);

    const videos = GenerationListResponseSchema.parse(
      (await json(await call('/generations?type=video', { key: KEYS.ownerRead }))).data,
    );
    expect(videos.items.map((item) => item.type)).toEqual(['video']);
  });

  it('deletes a generation, then answers 404 for it', async () => {
    const { generations: created } = await generateImages({ prompt: 'instant gone' });
    const { id } = created[0];

    const res = await call(`/generations/${id}`, { key: KEYS.ownerWrite, method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(DeletedResourceSchema.parse((await json(res)).data)).toEqual({ deleted: true, id });

    expect((await call(`/generations/${id}`, { key: KEYS.ownerRead })).status).toBe(404);
    expect(
      (await call(`/generations/${id}`, { key: KEYS.ownerWrite, method: 'DELETE' })).status,
    ).toBe(404);
  });
});

describe('ownership and workspace isolation', () => {
  it("hides another user's generations and topics", async () => {
    const created = await generateImages({ prompt: 'instant private' });
    const { id } = created.generations[0];

    const get = await call(`/generations/${id}`, { key: KEYS.stranger });
    const del = await call(`/generations/${id}`, { key: KEYS.stranger, method: 'DELETE' });
    const topic = await call('/images/generations', {
      body: { prompt: 'a cat', topicId: created.topicId },
      key: KEYS.stranger,
      method: 'POST',
    });
    for (const res of [get, del, topic]) {
      expect(res.status).toBe(404);
      expect((await json(res)).code).toBe('not_found');
    }

    const list = (await json(await call('/generations', { key: KEYS.stranger }))).data;
    expect(list).toMatchObject({ items: [], total: 0 });
    expect(await serverDB.select().from(generations)).toHaveLength(1);
  });

  it('keeps workspace and personal generations apart', async () => {
    const shared = await generateImages({ prompt: 'instant team' }, KEYS.workspace);
    expect(holder.createCalls[0].ctx).toMatchObject({ userId: OWNER, workspaceId: WORKSPACE });
    const { id } = shared.generations[0];

    // The same user's personal key cannot see the workspace row, and vice versa.
    expect((await call(`/generations/${id}`, { key: KEYS.ownerWrite })).status).toBe(404);
    const personalList = (await json(await call('/generations', { key: KEYS.ownerWrite }))).data;
    expect(personalList.total).toBe(0);

    const workspaceList = (await json(await call('/generations', { key: KEYS.workspace }))).data;
    expect(workspaceList.items.map((item: any) => item.id)).toEqual([id]);
    expect((await call(`/generations/${id}`, { key: KEYS.workspace })).status).toBe(200);
  });

  it('refuses a workspace key on another workspace', async () => {
    const res = await call('/generations', {
      key: KEYS.workspace,
      workspaceId: OTHER_WORKSPACE,
    });

    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('workspace_mismatch');
  });
});
