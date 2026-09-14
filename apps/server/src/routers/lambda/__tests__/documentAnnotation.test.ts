// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentModel } from '@/database/models/document';
import { DocumentAnnotationService } from '@/server/services/documentAnnotation';

import { documentAnnotationRouter } from '../documentAnnotation';

const mocks = vi.hoisted(() => ({
  assertCanPerformResourceAction: vi.fn(),
  documentFindById: vi.fn(),
  service: {
    bulkUpsertLegacy: vi.fn(),
    create: vi.fn(),
    findById: vi.fn(),
    listByDocument: vi.fn(),
    remove: vi.fn(),
    softDelete: vi.fn(),
    update: vi.fn(),
    updateStatus: vi.fn(),
    upsert: vi.fn(),
  },
}));

vi.mock('@/database/models/document', () => ({ DocumentModel: vi.fn() }));
vi.mock('@/server/services/documentAnnotation', () => ({
  DocumentAnnotationService: vi.fn(),
}));
vi.mock('@/server/services/resourcePermission', () => ({
  assertCanPerformResourceAction: mocks.assertCanPerformResourceAction,
}));
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const mod = await vi.importActual<{ trpc: any }>('@/libs/trpc/lambda/init');
  return { wsCompatProcedure: mod.trpc.procedure };
});
vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async (opts: any) =>
    opts.next({ ctx: { ...opts.ctx, serverDB: opts.ctx.serverDB ?? {} } }),
}));

describe('documentAnnotationRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertCanPerformResourceAction.mockResolvedValue(undefined);
    mocks.documentFindById.mockResolvedValue({ id: 'doc-personal' });
    vi.mocked(DocumentModel).mockImplementation(function () {
      return {
        findById: mocks.documentFindById,
      } as any;
    });
    vi.mocked(DocumentAnnotationService).mockImplementation(function () {
      return mocks.service as any;
    });
    mocks.service.listByDocument.mockResolvedValue([
      {
        createdAt: '2026-08-26T00:00:00.000Z',
        documentId: 'doc-1',
        id: 'annotation-1',
        kind: 'comment',
        nodeKeys: ['node-1'],
        payload: { text: 'hello' },
        quotedText: 'quote',
        status: 'active',
        updatedAt: '2026-08-26T00:00:00.000Z',
        version: 1,
      },
    ]);
    mocks.service.create.mockResolvedValue({
      annotation: { documentId: 'doc-1', id: 'annotation-1', version: 1 },
      isDuplicate: false,
    });
    mocks.service.update.mockResolvedValue({
      annotation: { documentId: 'doc-1', id: 'annotation-1', version: 2 },
    });
  });

  const callerFor = (workspaceId?: string) =>
    documentAnnotationRouter.createCaller({
      serverDB: {},
      userId: 'user-1',
      workspaceId: workspaceId ?? null,
    } as any);

  it('uses document view authorization before listing workspace annotations', async () => {
    const rows = await callerFor('workspace-1').listByDocument({ documentId: 'doc-1' });

    expect(rows).toHaveLength(1);
    expect(mocks.assertCanPerformResourceAction).toHaveBeenCalledWith({
      action: 'view',
      db: {},
      resourceId: 'doc-1',
      resourceType: 'document',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });
    expect(mocks.service.listByDocument).toHaveBeenCalledWith('doc-1', {
      includeDeleted: undefined,
    });
  });

  it('uses document edit authorization and forwards optimistic versions', async () => {
    await callerFor('workspace-1').update({
      documentId: 'doc-1',
      expectedVersion: 1,
      id: 'annotation-1',
      patch: { payload: { text: 'updated' } },
    });

    expect(mocks.assertCanPerformResourceAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'edit', resourceId: 'doc-1' }),
    );
    expect(mocks.service.update).toHaveBeenCalledWith(
      'doc-1',
      'annotation-1',
      { payload: { text: 'updated' } },
      1,
    );
  });

  it('accepts a flat editor record for create and returns the same record alias', async () => {
    const result = await callerFor('workspace-1').create({
      documentId: 'doc-1',
      id: 'annotation-1',
      kind: 'comment',
      nodeKeys: ['node-1'],
      payload: { text: 'hello' },
      quotedText: 'quote',
    });

    expect(mocks.service.create).toHaveBeenCalledWith('doc-1', {
      id: 'annotation-1',
      kind: 'comment',
      nodeKeys: ['node-1'],
      payload: { text: 'hello' },
      quotedText: 'quote',
    });
    expect(result).toMatchObject({ isDuplicate: false, record: { id: 'annotation-1' } });
  });

  it('falls back to personal document ownership when no workspace is scoped', async () => {
    await callerFor().listByDocument({ documentId: 'doc-personal' });

    expect(DocumentModel).toHaveBeenCalledWith({}, 'user-1');
    expect(mocks.documentFindById).toHaveBeenCalledWith('doc-personal');
    expect(mocks.assertCanPerformResourceAction).not.toHaveBeenCalled();
  });

  it('does not call the annotation service after a denied document access check', async () => {
    mocks.assertCanPerformResourceAction.mockRejectedValueOnce(
      new TRPCError({ code: 'FORBIDDEN', message: 'denied' }),
    );

    await expect(
      callerFor('workspace-1').listByDocument({ documentId: 'doc-1' }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(mocks.service.listByDocument).not.toHaveBeenCalled();
  });
});
