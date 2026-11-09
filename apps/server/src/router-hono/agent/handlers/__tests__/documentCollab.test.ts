// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  documentAccess,
  documentProjection,
  documentRoomStatus,
  documentSeed,
} from '../documentCollab';

const { buildPageSeed, getPageRoomStatus, persistPageState, resolvePageAccess } = vi.hoisted(
  () => ({
    buildPageSeed: vi.fn(),
    getPageRoomStatus: vi.fn(),
    persistPageState: vi.fn(),
    resolvePageAccess: vi.fn(),
  }),
);

vi.mock('@/server/services/pageCollab/seed', () => ({ buildPageSeed, getPageRoomStatus }));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: async () => ({}) }));

vi.mock('@/server/services/pageCollab', () => ({ persistPageState, resolvePageAccess }));

const buildContext = (options: { body?: unknown; query?: Record<string, string> }) =>
  ({
    json: (b: any, status = 200) => Response.json(b, { status }),
    req: {
      json: async () => options.body,
      query: (name: string) => options.query?.[name],
    },
  }) as any;

describe('documentAccess', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires a document and a user', async () => {
    const res = await documentAccess(buildContext({ query: { documentId: 'doc_1' } }));

    expect(res.status).toBe(400);
    expect(resolvePageAccess).not.toHaveBeenCalled();
  });

  it('returns the user access to the page', async () => {
    resolvePageAccess.mockResolvedValue('view');

    const res = await documentAccess(
      buildContext({ query: { documentId: 'doc_1', userId: 'u1' } }),
    );

    expect(await res.json()).toEqual({ access: 'view' });
    expect(resolvePageAccess).toHaveBeenCalledWith({}, 'u1', 'doc_1');
  });
});

describe('documentProjection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    persistPageState.mockResolvedValue(true);
  });

  const project = (body: unknown) => documentProjection(buildContext({ body }));

  it('requires a document and an update', async () => {
    expect((await project({ documentId: 'doc_1' })).status).toBe(400);
    expect(persistPageState).not.toHaveBeenCalled();
  });

  it('persists the room state as autosave attributed to the people editing in it', async () => {
    const res = await project({
      actors: ['u1', 'agent:u1', 'external:u2', 'bootstrap', 'u2', 42],
      documentId: 'doc_1',
      update: Buffer.from([1, 2, 3]).toString('base64'),
    });

    expect(res.status).toBe(200);
    expect(persistPageState).toHaveBeenCalledWith({}, 'doc_1', new Uint8Array([1, 2, 3]), {
      history: { editorIds: ['u1', 'u2'] },
      saveSource: 'autosave',
    });
  });

  it('persists without attribution when the room sends no actors', async () => {
    await project({ documentId: 'doc_1', update: '' });

    expect(persistPageState.mock.calls[0][3]).toEqual({
      history: { editorIds: undefined },
      saveSource: 'autosave',
    });
  });

  it('answers 404 for a page that no longer exists', async () => {
    persistPageState.mockResolvedValue(false);

    expect((await project({ documentId: 'doc_1', update: '' })).status).toBe(404);
  });

  it('answers 409 when the projection would erase blocks the room holds', async () => {
    const { PageProjectionRejectedError } = await import('@/server/services/pageCollab/persist');
    persistPageState.mockRejectedValue(new PageProjectionRejectedError('doc_1'));

    expect((await project({ documentId: 'doc_1', update: '' })).status).toBe(409);
  });

  it('answers 422 with the limit when the room grew the page past it', async () => {
    const { TRPCError } = await import('@trpc/server');
    persistPageState.mockRejectedValue(
      new TRPCError({
        cause: {
          data: {
            actual: 501_502,
            code: 'DocumentCharLimitExceeded',
            limit: 500_000,
            plan: 'plus',
          },
        },
        code: 'BAD_REQUEST',
        message: 'Document is too long',
      }),
    );

    const res = await project({ documentId: 'doc_1', update: '' });

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      actual: 501_502,
      code: 'DocumentCharLimitExceeded',
      error: 'Document is too long',
      limit: 500_000,
      plan: 'plus',
    });
  });
});

describe('documentSeed', () => {
  beforeEach(() => vi.clearAllMocks());

  const seed = (documentId?: string) =>
    documentSeed(buildContext({ query: documentId ? { documentId } : {} }));

  it('requires a document', async () => {
    expect((await seed()).status).toBe(400);
  });

  it('returns the seed as binary Yjs with the page workspace', async () => {
    buildPageSeed.mockResolvedValue({
      status: 'ok',
      update: new Uint8Array([7, 8, 9]),
      workspaceId: 'ws_1',
    });

    const res = await seed('doc_1');

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(res.headers.get('X-Workspace-Id')).toBe('ws_1');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([7, 8, 9]));
  });

  it('answers 404 DOCUMENT_NOT_FOUND for a missing page', async () => {
    buildPageSeed.mockResolvedValue({ status: 'not_found' });

    const res = await seed('doc_1');

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'DOCUMENT_NOT_FOUND' });
  });

  it('answers 403 ROOM_NOT_ALLOWED for a page outside any workspace', async () => {
    buildPageSeed.mockResolvedValue({ status: 'not_allowed' });

    const res = await seed('doc_1');

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'ROOM_NOT_ALLOWED' });
  });
});

describe('documentRoomStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires a document', async () => {
    expect((await documentRoomStatus(buildContext({ query: {} }))).status).toBe(400);
  });

  it('returns whether the page exists and is in a workspace', async () => {
    getPageRoomStatus.mockResolvedValue({ exists: true, inWorkspace: false, workspaceId: null });

    const res = await documentRoomStatus(buildContext({ query: { documentId: 'doc_1' } }));

    expect(await res.json()).toEqual({ exists: true, inWorkspace: false, workspaceId: null });
    expect(getPageRoomStatus).toHaveBeenCalledWith({}, 'doc_1');
  });
});
