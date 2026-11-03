// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { documentAccess, documentProjection } from '../documentCollab';

const { persistPageState, resolvePageAccess } = vi.hoisted(() => ({
  persistPageState: vi.fn(),
  resolvePageAccess: vi.fn(),
}));

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
});
