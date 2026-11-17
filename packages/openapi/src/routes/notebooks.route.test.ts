// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/api/v1/notebooks` over real HTTP: real routes behind the `app.ts` auth and
 * workspace middlewares, real permission/scope gates, controller, REST service
 * and the shared `notebook` procedures, on PGlite. API keys are real
 * `api_keys` rows; only the database handle is pointed at PGlite.
 */
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');

const holder = vi.hoisted(() => ({ serverDB: undefined as unknown }));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => holder.serverDB,
}));

const { getTestDB } = await import('@/database/core/getTestDB');
const { apiKeys, documents, topicDocuments, topics, users } = await import('@/database/schemas');
const { hashApiKey } = await import('@lobechat/utils/server');
const { HTTPException } = await import('hono/http-exception');
const { errorInitFromException, renderApiError } = await import('../common/errors');
const { userAuthMiddleware } = await import('../middleware/auth');
const { workspaceAuthMiddleware } = await import('../middleware/workspace');
const { NotebookDocumentSchema, NotebookTopicDocumentSchema } =
  await import('../types/notebook.type');
const NotebookRoutes = (await import('./notebooks.route')).default;
const DocumentRoutes = (await import('./documents.route')).default;

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
app.route('/notebooks', NotebookRoutes);
app.route('/documents', DocumentRoutes);

const OWNER = 'r3-notebook-owner';
const STRANGER = 'r3-notebook-stranger';
const TOPIC = 'tpc_r3_owner_topic';
const STRANGER_TOPIC = 'tpc_r3_stranger_topic';

const KEYS = {
  chatOnly: 'sk-lh-r3nbchatonly0001',
  ownerRead: 'sk-lh-r3nbownerread001',
  ownerWrite: 'sk-lh-r3nbownerwrite01',
  stranger: 'sk-lh-r3nbstranger0001',
} as const;

const call = (path: string, init: { body?: unknown; key?: string; method?: string } = {}) =>
  app.request(`/api/v1${path}`, {
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    headers: {
      ...(init.key ? { authorization: `Bearer ${init.key}` } : {}),
      'content-type': 'application/json',
    },
    method: init.method ?? 'GET',
  });

const json = async (res: Response) => (await res.json()) as any;

const writeNote = async (body: Record<string, unknown> = {}, key: string = KEYS.ownerWrite) =>
  call('/notebooks', {
    body: {
      content: '# Findings\n\n- the cache is cold',
      description: 'What the run found',
      title: 'Findings',
      topicId: TOPIC,
      ...body,
    },
    key,
    method: 'POST',
  });

beforeEach(async () => {
  await serverDB.delete(topicDocuments);
  await serverDB.delete(documents);
  await serverDB.delete(topics);
  await serverDB.delete(apiKeys);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: OWNER }, { id: STRANGER }]);
  await serverDB.insert(topics).values([
    { id: TOPIC, title: 'Owner topic', userId: OWNER },
    { id: STRANGER_TOPIC, title: 'Stranger topic', userId: STRANGER },
  ]);
  const key = (value: string, userId: string, scopes: string[]) => ({
    key: value,
    keyHash: hashApiKey(value),
    name: value,
    scopes,
    userId,
  });
  await serverDB
    .insert(apiKeys)
    .values([
      key(KEYS.ownerWrite, OWNER, ['document:write']),
      key(KEYS.ownerRead, OWNER, ['document:read']),
      key(KEYS.chatOnly, OWNER, ['chat:write']),
      key(KEYS.stranger, STRANGER, ['document:write']),
    ]);
});

describe('authentication and API-key scopes', () => {
  it('answers 401 without credentials', async () => {
    expect((await call(`/notebooks?topicId=${TOPIC}`)).status).toBe(401);
  });

  it('refuses a key without a document scope', async () => {
    const res = await call(`/notebooks?topicId=${TOPIC}`, { key: KEYS.chatOnly });

    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('insufficient_scope');
  });

  it('lets a document:read key list but not write', async () => {
    expect((await call(`/notebooks?topicId=${TOPIC}`, { key: KEYS.ownerRead })).status).toBe(200);

    const res = await writeNote({}, KEYS.ownerRead);
    expect(res.status).toBe(403);

    const associate = await call('/notebooks/associate', {
      body: { documentId: 'docs_x', topicId: TOPIC },
      key: KEYS.ownerRead,
      method: 'POST',
    });
    expect(associate.status).toBe(403);
  });
});

describe('request validation', () => {
  it('requires a topicId to list', async () => {
    const res = await call('/notebooks', { key: KEYS.ownerRead });

    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe('validation_error');
  });

  it('rejects a document without content, an unknown kind and an empty update', async () => {
    const missing = await call('/notebooks', {
      body: { description: 'd', title: 't', topicId: TOPIC },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    const kind = await writeNote({ type: 'spreadsheet' });
    const created = (await json(await writeNote())).data;
    const empty = await call(`/notebooks/${created.id}`, {
      body: {},
      key: KEYS.ownerWrite,
      method: 'PATCH',
    });

    expect([missing.status, kind.status, empty.status]).toEqual([400, 400, 400]);
  });
});

describe('notebook documents', () => {
  it('writes, lists, reads, appends to and deletes Markdown documents', async () => {
    const created = await writeNote();
    expect(created.status).toBe(201);
    const note = NotebookDocumentSchema.parse((await json(created)).data);
    expect(note).toMatchObject({
      content: '# Findings\n\n- the cache is cold',
      fileType: 'markdown',
    });

    // The same write again is the same document, not a copy.
    const twin = (await json(await writeNote())).data;
    expect(twin.id).toBe(note.id);

    const list = await json(await call(`/notebooks?topicId=${TOPIC}`, { key: KEYS.ownerRead }));
    expect(list.data).toMatchObject({ hasMore: false, nextCursor: null, total: 1 });
    expect(NotebookTopicDocumentSchema.parse(list.data.items[0]).id).toBe(note.id);

    const got = await json(await call(`/notebooks/${note.id}`, { key: KEYS.ownerRead }));
    expect(got.data.title).toBe('Findings');

    const appended = await json(
      await call(`/notebooks/${note.id}`, {
        body: { append: true, content: '- and the index is missing' },
        key: KEYS.ownerWrite,
        method: 'PATCH',
      }),
    );
    expect(appended.data.content).toBe(
      '# Findings\n\n- the cache is cold\n\n- and the index is missing',
    );

    const removed = await json(
      await call(`/notebooks/${note.id}`, { key: KEYS.ownerWrite, method: 'DELETE' }),
    );
    expect(removed.data).toEqual({ deleted: true, id: note.id });
    expect((await call(`/notebooks/${note.id}`, { key: KEYS.ownerRead })).status).toBe(404);
  });

  it('adds an existing document to a notebook without copying it', async () => {
    const doc = (
      await json(
        await call('/documents', {
          body: { content: 'Spec body', title: 'Spec' },
          key: KEYS.ownerWrite,
          method: 'POST',
        }),
      )
    ).data;

    const first = await call('/notebooks/associate', {
      body: { documentId: doc.id, topicId: TOPIC },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(await json(first)).toMatchObject({ data: { documentId: doc.id, topicId: TOPIC } });

    // Repeating the call is a no-op.
    await call('/notebooks/associate', {
      body: { documentId: doc.id, topicId: TOPIC },
      key: KEYS.ownerWrite,
      method: 'POST',
    });

    const list = await json(await call(`/notebooks?topicId=${TOPIC}`, { key: KEYS.ownerRead }));
    expect(list.data.items.map((item: any) => item.id)).toEqual([doc.id]);
  });

  it('pages through a notebook with the returned cursor', async () => {
    for (const title of ['One', 'Two', 'Three']) {
      await writeNote({ content: `${title} body`, title });
    }

    const first = await json(
      await call(`/notebooks?topicId=${TOPIC}&limit=2`, { key: KEYS.ownerRead }),
    );
    expect(first.data.items).toHaveLength(2);
    expect(first.data).toMatchObject({ hasMore: true, total: 3 });

    const second = await json(
      await call(`/notebooks?topicId=${TOPIC}&limit=2&cursor=${first.data.nextCursor}`, {
        key: KEYS.ownerRead,
      }),
    );
    expect(second.data.items).toHaveLength(1);
    expect(second.data).toMatchObject({ hasMore: false, nextCursor: null });
  });
});

describe('notebook boundary', () => {
  const createPage = async () =>
    (
      await json(
        await call('/documents', {
          body: { content: 'Page body', title: 'A page' },
          key: KEYS.ownerWrite,
          method: 'POST',
        }),
      )
    ).data;

  it('does not address a document that is in no notebook', async () => {
    const page = await createPage();

    for (const [method, body] of [
      ['GET', undefined],
      ['PATCH', { content: 'overwritten' }],
      ['DELETE', undefined],
    ] as const) {
      const res = await call(`/notebooks/${page.id}`, { body, key: KEYS.ownerWrite, method });
      expect({ method, status: res.status }).toEqual({ method, status: 404 });
    }
    const after = await json(await call(`/documents/${page.id}`, { key: KEYS.ownerRead }));
    expect(after.data.content).toBe('Page body');
  });

  it('refuses a Markdown-only write to a page attached to a notebook', async () => {
    const page = await createPage();
    await call('/notebooks/associate', {
      body: { documentId: page.id, topicId: TOPIC },
      key: KEYS.ownerWrite,
      method: 'POST',
    });

    expect((await call(`/notebooks/${page.id}`, { key: KEYS.ownerRead })).status).toBe(200);
    const res = await call(`/notebooks/${page.id}`, {
      body: { content: 'overwritten' },
      key: KEYS.ownerWrite,
      method: 'PATCH',
    });
    expect(res.status).toBe(422);
    expect((await json(res)).code).toBe('unprocessable_entity');
  });
});

describe('ownership', () => {
  it("does not read or write another account's topic notebook", async () => {
    const list = await call(`/notebooks?topicId=${TOPIC}`, { key: KEYS.stranger });
    const write = await writeNote({}, KEYS.stranger);

    expect([list.status, write.status]).toEqual([404, 404]);
  });

  it("hides another account's notebook document on every route", async () => {
    const note = (await json(await writeNote())).data;

    for (const [method, body] of [
      ['GET', undefined],
      ['PATCH', { title: 'Hijacked' }],
      ['DELETE', undefined],
    ] as const) {
      const res = await call(`/notebooks/${note.id}`, { body, key: KEYS.stranger, method });
      expect({ method, status: res.status }).toEqual({ method, status: 404 });
    }

    // Nor attach it to the stranger's own topic.
    const associate = await call('/notebooks/associate', {
      body: { documentId: note.id, topicId: STRANGER_TOPIC },
      key: KEYS.stranger,
      method: 'POST',
    });
    expect(associate.status).toBe(404);

    const after = await json(await call(`/notebooks/${note.id}`, { key: KEYS.ownerRead }));
    expect(after.data.title).toBe('Findings');
  });
});
