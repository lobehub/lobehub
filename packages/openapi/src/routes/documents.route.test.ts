// @vitest-environment node
import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/api/v1/documents` over real HTTP: the real `DocumentRoutes` behind the same
 * auth + workspace middlewares `app.ts` mounts, the real permission/scope gates,
 * controller, REST service and the shared `document` / `documentComment` /
 * `pageShare` procedures it calls, on a PGlite database. API keys are real rows
 * in `api_keys`, so scope narrowing and workspace binding run exactly as in
 * production. Nothing under test is mocked; only the database handle is
 * pointed at PGlite.
 */
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');

const holder = vi.hoisted(() => ({ serverDB: undefined as unknown }));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => holder.serverDB,
}));

const { getTestDB } = await import('@/database/core/getTestDB');
const { apiKeys, documents, users, workspaceMembers, workspaces } =
  await import('@/database/schemas');
const { hashApiKey } = await import('@lobechat/utils/server');
const { HTTPException } = await import('hono/http-exception');
const { errorInitFromException, renderApiError } = await import('../common/errors');
const { userAuthMiddleware } = await import('../middleware/auth');
const { workspaceAuthMiddleware } = await import('../middleware/workspace');
const { DocumentSchema, DocumentShareSchema, DocumentVersionSchema } =
  await import('../types/document.type');
const { DocumentCommentSchema } = await import('../types/document-comment.type');
const DocumentRoutes = (await import('./documents.route')).default;

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
app.route('/documents', DocumentRoutes);

const OWNER = 'r3-docs-owner';
const STRANGER = 'r3-docs-stranger';
const WORKSPACE = 'r3-docs-ws';
const OTHER_WORKSPACE = 'r3-docs-other-ws';

/** `sk-lh-` + 16 lowercase alphanumerics — the format the auth middleware checks. */
const KEYS = {
  knowledgeOnly: 'sk-lh-r3docsknowonly01',
  ownerRead: 'sk-lh-r3docsownerread1',
  ownerWrite: 'sk-lh-r3docsownerwrit1',
  stranger: 'sk-lh-r3docsstranger01',
  workspace: 'sk-lh-r3docsworkspace1',
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

const createDocument = async (body: Record<string, unknown>, key: string = KEYS.ownerWrite) => {
  const res = await call('/documents', { body, key, method: 'POST' });
  expect(res.status).toBe(201);
  return (await json(res)).data;
};

beforeAll(async () => {
  await serverDB.delete(documents);
  await serverDB.delete(apiKeys);
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
});

beforeEach(async () => {
  await serverDB.delete(documents);
  await serverDB.delete(apiKeys);
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: OWNER }, { id: STRANGER }]);
  await serverDB.insert(workspaces).values([
    { id: WORKSPACE, name: 'R3 docs', primaryOwnerId: OWNER, slug: 'r3-docs' },
    { id: OTHER_WORKSPACE, name: 'R3 other', primaryOwnerId: STRANGER, slug: 'r3-other' },
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
      key(KEYS.ownerWrite, OWNER, ['document:write']),
      key(KEYS.ownerRead, OWNER, ['document:read']),
      key(KEYS.knowledgeOnly, OWNER, ['knowledge:write']),
      key(KEYS.stranger, STRANGER, ['document:write']),
      key(KEYS.workspace, OWNER, ['document:write'], WORKSPACE),
    ]);
});

describe('authentication and API-key scopes', () => {
  it('answers 401 without credentials', async () => {
    const res = await call('/documents');

    expect(res.status).toBe(401);
  });

  it('refuses a key that holds only knowledge:* scopes', async () => {
    const res = await call('/documents', { key: KEYS.knowledgeOnly });

    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('insufficient_scope');
  });

  it('lets a document:read key read but not write', async () => {
    expect((await call('/documents', { key: KEYS.ownerRead })).status).toBe(200);

    const res = await call('/documents', {
      body: { content: '# Hi', title: 'Hi' },
      key: KEYS.ownerRead,
      method: 'POST',
    });
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('insufficient_scope');
  });

  it('refuses write-only sub-resources to a read-only key', async () => {
    const doc = await createDocument({ content: 'body', title: 'Read only' });
    for (const [path, method] of [
      [`/documents/${doc.id}/versions`, 'POST'],
      [`/documents/${doc.id}/share`, 'POST'],
      [`/documents/${doc.id}/share`, 'DELETE'],
      [`/documents/${doc.id}/comments`, 'POST'],
      [`/documents/${doc.id}/move`, 'POST'],
    ] as const) {
      const res = await call(path, { body: {}, key: KEYS.ownerRead, method });
      expect({ method, path, status: res.status }).toEqual({ method, path, status: 403 });
    }
  });
});

describe('request validation', () => {
  it('rejects a document without a title', async () => {
    const res = await call('/documents', {
      body: { content: 'no title' },
      key: KEYS.ownerWrite,
      method: 'POST',
    });

    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe('validation_error');
  });

  it('rejects an empty update, a move without parentId and an out-of-range page size', async () => {
    const doc = await createDocument({ content: 'body', title: 'Validate me' });

    const empty = await call(`/documents/${doc.id}`, {
      body: {},
      key: KEYS.ownerWrite,
      method: 'PATCH',
    });
    const move = await call(`/documents/${doc.id}/move`, {
      body: {},
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    const page = await call('/documents?limit=0', { key: KEYS.ownerWrite });
    const compare = await call(`/documents/${doc.id}/versions/compare?from=a`, {
      key: KEYS.ownerWrite,
    });

    expect([empty.status, move.status, page.status, compare.status]).toEqual([400, 400, 400, 400]);
  });

  it('rejects an empty batch and a non-array of ids', async () => {
    const batch = await call('/documents/batch', {
      body: { documents: [] },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    const remove = await call('/documents/batch-delete', {
      body: { ids: 'docs_1' },
      key: KEYS.ownerWrite,
      method: 'POST',
    });

    expect([batch.status, remove.status]).toEqual([400, 400]);
  });

  it('rejects a cursor this endpoint did not issue', async () => {
    const doc = await createDocument({ content: 'body', title: 'Cursor' });
    const res = await call(`/documents/${doc.id}/versions?cursor=bm90LWEtY3Vyc29y`, {
      key: KEYS.ownerWrite,
    });

    expect(res.status).toBe(400);
  });
});

describe('documents: Markdown in, Markdown out', () => {
  it('creates, reads, searches, updates, moves and deletes', async () => {
    const folder = await createDocument({ fileType: 'custom/folder', title: 'Plans' });
    const page = await createDocument({
      content: '## Goals\n\n- Ship the documents API',
      metadata: { emoji: '🗺️' },
      parentId: folder.id,
      title: 'Q3 roadmap',
    });

    expect(DocumentSchema.parse(page)).toBeTruthy();
    expect(page.parentId).toBe(folder.id);
    expect(page.content).toContain('Ship the documents API');
    // editorData is built server-side from the Markdown.
    expect(page.editorData?.root?.type).toBe('root');

    const got = await json(await call(`/documents/${page.id}`, { key: KEYS.ownerRead }));
    expect(DocumentSchema.parse(got.data).content).toContain('## Goals');

    const search = await json(await call('/documents?keyword=ROADMAP', { key: KEYS.ownerRead }));
    expect(search.data.items.map((item: any) => item.id)).toEqual([page.id]);
    expect(search.data).toMatchObject({ hasMore: false, nextCursor: null, total: 1 });

    const inFolder = await json(
      await call(`/documents?parentId=${folder.id}`, { key: KEYS.ownerRead }),
    );
    expect(inFolder.data.items.map((item: any) => item.id)).toEqual([page.id]);

    const updated = await json(
      await call(`/documents/${page.id}`, {
        body: { content: '## Goals\n\n- Ship it **today**', title: 'Q3 roadmap v2' },
        key: KEYS.ownerWrite,
        method: 'PATCH',
      }),
    );
    expect(updated.data.title).toBe('Q3 roadmap v2');
    expect(updated.data.content).toContain('**today**');

    const breadcrumb = await json(
      await call(`/documents/${page.id}/breadcrumb`, { key: KEYS.ownerRead }),
    );
    expect(breadcrumb.data.items.map((item: any) => item.id)).toEqual([folder.id, page.id]);

    const moved = await json(
      await call(`/documents/${page.id}/move`, {
        body: { parentId: null },
        key: KEYS.ownerWrite,
        method: 'POST',
      }),
    );
    expect(moved.data.parentId).toBeNull();

    const root = await json(await call('/documents?parentId=root', { key: KEYS.ownerRead }));
    expect(root.data.items.map((item: any) => item.id).sort()).toEqual([folder.id, page.id].sort());

    const removed = await call(`/documents/${page.id}`, {
      key: KEYS.ownerWrite,
      method: 'DELETE',
    });
    expect(await json(removed)).toMatchObject({ data: { deleted: true, id: page.id } });
    expect((await call(`/documents/${page.id}`, { key: KEYS.ownerRead })).status).toBe(404);
  });

  it('keeps editor JSON when the client sends it', async () => {
    const editorData = {
      root: {
        children: [
          {
            children: [
              {
                detail: 0,
                format: 0,
                mode: 'normal',
                style: '',
                text: 'Hello',
                type: 'text',
                version: 1,
              },
            ],
            direction: 'ltr',
            format: '',
            indent: 0,
            type: 'paragraph',
            version: 1,
          },
        ],
        direction: 'ltr',
        format: '',
        indent: 0,
        type: 'root',
        version: 1,
      },
    };
    const doc = await createDocument({ content: 'Hello', editorData, title: 'Rich' });

    expect(doc.editorData).toEqual(editorData);
    expect(doc.content).toBe('Hello');
  });

  it('pages through a list with the returned cursor', async () => {
    for (const title of ['a', 'b', 'c']) await createDocument({ content: title, title });

    const first = await json(
      await call('/documents?limit=2&sortBy=title', { key: KEYS.ownerRead }),
    );
    expect(first.data.items.map((item: any) => item.title)).toEqual(['a', 'b']);
    expect(first.data.hasMore).toBe(true);

    const second = await json(
      await call(`/documents?limit=2&sortBy=title&cursor=${first.data.nextCursor}`, {
        key: KEYS.ownerRead,
      }),
    );
    expect(second.data.items.map((item: any) => item.title)).toEqual(['c']);
    expect(second.data).toMatchObject({ hasMore: false, nextCursor: null, total: 3 });
  });

  it('creates and deletes in bulk', async () => {
    const created = await json(
      await call('/documents/batch', {
        body: {
          documents: [
            { content: 'one', title: 'One' },
            { content: 'two', title: 'Two' },
          ],
        },
        key: KEYS.ownerWrite,
        method: 'POST',
      }),
    );
    expect(created.data.items.map((item: any) => item.title)).toEqual(['One', 'Two']);

    const ids = created.data.items.map((item: any) => item.id);
    const removed = await json(
      await call('/documents/batch-delete', {
        body: { ids },
        key: KEYS.ownerWrite,
        method: 'POST',
      }),
    );
    expect(removed.data).toEqual({ count: 2, deleted: true });
    expect((await json(await call('/documents', { key: KEYS.ownerRead }))).data.total).toBe(0);
  });

  it('refuses to move a folder into its own subtree', async () => {
    const parent = await createDocument({ fileType: 'custom/folder', title: 'Parent' });
    const child = await createDocument({
      fileType: 'custom/folder',
      parentId: parent.id,
      title: 'Child',
    });

    const res = await call(`/documents/${parent.id}/move`, {
      body: { parentId: child.id },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(res.status).toBe(400);
  });
});

describe('versions', () => {
  it('saves, lists, reads, compares and restores versions as Markdown', async () => {
    const doc = await createDocument({ content: 'First draft', title: 'Versioned' });

    const saved = await call(`/documents/${doc.id}/versions`, {
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(saved.status).toBe(201);
    const savedVersion = (await json(saved)).data;

    await call(`/documents/${doc.id}`, {
      body: { content: 'Second draft' },
      key: KEYS.ownerWrite,
      method: 'PATCH',
    });

    const list = await json(await call(`/documents/${doc.id}/versions`, { key: KEYS.ownerRead }));
    const ids = list.data.items.map((item: any) => item.id);
    expect(ids).toContain(savedVersion.id);
    expect(list.data.items[0].isCurrent).toBe(true);

    const version = await json(
      await call(`/documents/${doc.id}/versions/${savedVersion.id}`, { key: KEYS.ownerRead }),
    );
    expect(DocumentVersionSchema.parse(version.data).content).toContain('First draft');

    const current = list.data.items[0].id;
    const compare = await json(
      await call(`/documents/${doc.id}/versions/compare?from=${savedVersion.id}&to=${current}`, {
        key: KEYS.ownerRead,
      }),
    );
    expect(compare.data.from.content).toContain('First draft');
    expect(compare.data.to.content).toContain('Second draft');

    const restored = await json(
      await call(`/documents/${doc.id}/versions/${savedVersion.id}/restore`, {
        key: KEYS.ownerWrite,
        method: 'POST',
      }),
    );
    expect(restored.data.content).toContain('First draft');
    expect(
      (await json(await call(`/documents/${doc.id}`, { key: KEYS.ownerRead }))).data.content,
    ).toContain('First draft');
  });
});

describe('share link', () => {
  it('reports a private page and answers 412 where page sharing is not deployed', async () => {
    const doc = await createDocument({ content: 'Share me', title: 'Shared' });

    const state = await json(await call(`/documents/${doc.id}/share`, { key: KEYS.ownerRead }));
    expect(DocumentShareSchema.parse(state.data)).toEqual({
      documentId: doc.id,
      pageViewCount: 0,
      permission: 'read',
      url: null,
      visibility: 'private',
    });

    const enable = await call(`/documents/${doc.id}/share`, {
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(enable.status).toBe(412);
    expect((await json(enable)).code).toBe('precondition_failed');
  });
});

describe('ownership and workspace isolation', () => {
  it("hides another account's document on every route", async () => {
    const doc = await createDocument({ content: 'Mine', title: 'Private to owner' });

    const attempts = [
      ['GET', `/documents/${doc.id}`, undefined],
      ['PATCH', `/documents/${doc.id}`, { title: 'Hijacked' }],
      ['DELETE', `/documents/${doc.id}`, undefined],
      ['POST', `/documents/${doc.id}/move`, { parentId: null }],
      ['GET', `/documents/${doc.id}/versions`, undefined],
      ['POST', `/documents/${doc.id}/versions`, undefined],
      ['GET', `/documents/${doc.id}/share`, undefined],
      ['POST', `/documents/${doc.id}/share`, undefined],
      ['GET', `/documents/${doc.id}/breadcrumb`, undefined],
    ] as const;
    for (const [method, path, body] of attempts) {
      const res = await call(path, { body, key: KEYS.stranger, method });
      expect({ method, path, status: res.status }).toEqual({ method, path, status: 404 });
    }

    const list = await json(await call('/documents', { key: KEYS.stranger }));
    expect(list.data.items).toEqual([]);

    const bulk = await call('/documents/batch-delete', {
      body: { ids: [doc.id] },
      key: KEYS.stranger,
      method: 'POST',
    });
    expect(bulk.status).toBe(404);

    const after = await json(await call(`/documents/${doc.id}`, { key: KEYS.ownerRead }));
    expect(after.data.title).toBe('Private to owner');
  });

  it('refuses a personal key on a workspace and a workspace key on another workspace', async () => {
    const personal = await call('/documents', { key: KEYS.ownerWrite, workspaceId: WORKSPACE });
    const otherWorkspace = await call('/documents', {
      key: KEYS.workspace,
      workspaceId: OTHER_WORKSPACE,
    });
    const notMember = await call('/documents', {
      key: KEYS.stranger,
      workspaceId: WORKSPACE,
    });

    for (const res of [personal, otherWorkspace, notMember]) {
      expect(res.status).toBe(403);
      expect((await json(res)).code).toBe('workspace_mismatch');
    }
  });

  it('keeps personal and workspace documents apart', async () => {
    const personal = await createDocument({ content: 'Personal', title: 'Personal page' });
    const shared = await createDocument(
      { content: 'Workspace', title: 'Workspace page' },
      KEYS.workspace,
    );
    expect(shared.workspaceId).toBe(WORKSPACE);

    expect((await call(`/documents/${personal.id}`, { key: KEYS.workspace })).status).toBe(404);
    expect((await call(`/documents/${shared.id}`, { key: KEYS.ownerRead })).status).toBe(404);

    const workspaceList = await json(await call('/documents', { key: KEYS.workspace }));
    expect(workspaceList.data.items.map((item: any) => item.id)).toEqual([shared.id]);
  });
});

describe('comments', () => {
  it('answers 412 outside a workspace', async () => {
    const doc = await createDocument({ content: 'Body', title: 'Personal' });
    const res = await call(`/documents/${doc.id}/comments`, { key: KEYS.ownerRead });

    expect(res.status).toBe(412);
    expect((await json(res)).code).toBe('precondition_failed');
  });

  it('threads, replies, edits and deletes comments in a workspace', async () => {
    const doc = await createDocument({ content: 'Review this', title: 'Spec' }, KEYS.workspace);

    const created = await call(`/documents/${doc.id}/comments`, {
      body: { content: 'Looks good' },
      key: KEYS.workspace,
      method: 'POST',
    });
    expect(created.status).toBe(201);
    const root = (await json(created)).data.comment;
    expect(DocumentCommentSchema.parse(root).content).toBe('Looks good');

    const reply = (
      await json(
        await call(`/documents/${doc.id}/comments`, {
          body: { content: 'Agreed', parentCommentId: root.id },
          key: KEYS.workspace,
          method: 'POST',
        }),
      )
    ).data.comment;
    expect(reply.parentCommentId).toBe(root.id);

    const threads = await json(
      await call(`/documents/${doc.id}/comments`, { key: KEYS.workspace }),
    );
    expect(threads.data.items).toHaveLength(1);
    expect(threads.data.items[0]).toMatchObject({ replyCount: 1, root: { id: root.id } });
    expect(threads.data).toMatchObject({ hasMore: false, nextCursor: null });

    const replies = await json(
      await call(`/documents/${doc.id}/comments/${root.id}/replies`, { key: KEYS.workspace }),
    );
    expect(replies.data.items.map((item: any) => item.id)).toEqual([reply.id]);

    const edited = await json(
      await call(`/documents/${doc.id}/comments/${reply.id}`, {
        body: { content: 'Agreed, ship it' },
        key: KEYS.workspace,
        method: 'PATCH',
      }),
    );
    expect(edited.data.content).toBe('Agreed, ship it');

    const removed = await json(
      await call(`/documents/${doc.id}/comments/${reply.id}`, {
        key: KEYS.workspace,
        method: 'DELETE',
      }),
    );
    expect(removed.data).toEqual({ id: reply.id, mode: 'hard' });
  });

  it('does not reach a comment through a document it does not belong to', async () => {
    const doc = await createDocument({ content: 'One', title: 'One' }, KEYS.workspace);
    const other = await createDocument({ content: 'Two', title: 'Two' }, KEYS.workspace);
    const root = (
      await json(
        await call(`/documents/${doc.id}/comments`, {
          body: { content: 'On one' },
          key: KEYS.workspace,
          method: 'POST',
        }),
      )
    ).data.comment;

    const res = await call(`/documents/${other.id}/comments/${root.id}`, {
      body: { content: 'moved?' },
      key: KEYS.workspace,
      method: 'PATCH',
    });
    expect(res.status).toBe(404);
  });

  it('rejects a comment with neither text nor attachment', async () => {
    const doc = await createDocument({ content: 'Body', title: 'Empty' }, KEYS.workspace);
    const res = await call(`/documents/${doc.id}/comments`, {
      body: {},
      key: KEYS.workspace,
      method: 'POST',
    });

    expect(res.status).toBe(400);
  });
});
