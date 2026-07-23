// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TransferErrorCode } from '@/types/transferError';

const mocks = vi.hoisted(() => ({
  assertCanEditResource: vi.fn(),
  assertCanPerformResourceAction: vi.fn(),
  businessFileTransferStorageCheck: vi.fn(),
  countFileUsageInSubtree: vi.fn(),
  findById: vi.fn(),
  getResourceMeta: vi.fn(),
  subtreeHasForeignRows: vi.fn(),
  transferTo: vi.fn(),
  updateDocument: vi.fn(),
}));

vi.mock('@/business/server/lambda-routers/file', () => ({
  businessFileTransferStorageCheck: mocks.businessFileTransferStorageCheck,
}));
vi.mock('@/database/models/chunk', () => ({ ChunkModel: vi.fn(() => ({})) }));
vi.mock('@/database/models/document', () => ({
  DocumentModel: vi.fn(() => ({
    countFileUsageInSubtree: mocks.countFileUsageInSubtree,
    findById: mocks.findById,
    subtreeHasForeignRows: mocks.subtreeHasForeignRows,
    transferTo: mocks.transferTo,
  })),
}));
vi.mock('@/database/models/file', () => ({ FileModel: vi.fn(() => ({})) }));
vi.mock('@/database/models/message', () => ({ MessageModel: vi.fn(() => ({})) }));
vi.mock('@/database/models/resourcePermission', () => ({
  ResourcePermissionModel: vi.fn(() => ({ removeAll: vi.fn(), setAccessLevel: vi.fn() })),
}));
vi.mock('@/server/services/document', () => ({
  DocumentService: vi.fn(() => ({ updateDocument: mocks.updateDocument })),
}));
vi.mock('@/server/services/resourcePermission', () => ({
  assertCanEditResource: mocks.assertCanEditResource,
  assertCanPerformResourceAction: mocks.assertCanPerformResourceAction,
  buildResourcePermissionState: vi.fn(),
  getResourceMeta: mocks.getResourceMeta,
}));
vi.mock('@/server/services/workspacePermission', () => ({
  hasWorkspaceScopedPermission: vi.fn(),
}));

const { documentRouter } = await import('../document');

describe('documentRouter transferDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertCanPerformResourceAction.mockResolvedValue(undefined);
    mocks.assertCanEditResource.mockResolvedValue(undefined);
    mocks.findById.mockResolvedValue({
      id: 'doc-1',
      parentId: 'old-parent',
      userId: 'member-1',
      visibility: 'public',
      workspaceId: 'ws-1',
    });
    mocks.getResourceMeta.mockResolvedValue({
      userId: 'creator-1',
      visibility: 'public',
      workspaceId: 'ws-1',
    });
    mocks.subtreeHasForeignRows.mockResolvedValue(false);
  });

  it('blocks a non-owner from transferring a tree containing foreign rows', async () => {
    mocks.subtreeHasForeignRows.mockResolvedValueOnce(true);
    const caller = documentRouter.createCaller({
      serverDB: {},
      userId: 'member-1',
      workspaceId: 'ws-1',
      workspaceRole: 'member',
    } as any);

    await expect(
      caller.transferDocument({ documentId: 'doc-1', targetWorkspaceId: null }),
    ).rejects.toMatchObject({
      cause: { data: { code: TransferErrorCode.OwnerOnly } },
      code: 'FORBIDDEN',
    });

    expect(mocks.subtreeHasForeignRows).toHaveBeenCalledWith('doc-1');
    expect(mocks.countFileUsageInSubtree).not.toHaveBeenCalled();
    expect(mocks.transferTo).not.toHaveBeenCalled();
  });

  it('checks edit access on both the source and destination parents before moving a document', async () => {
    mocks.assertCanEditResource
      .mockResolvedValueOnce(undefined) // the document itself
      .mockResolvedValueOnce(undefined) // the current (source) parent
      .mockRejectedValueOnce(new TRPCError({ code: 'FORBIDDEN' })); // the destination parent
    const caller = documentRouter.createCaller({
      serverDB: {},
      userId: 'member-1',
      workspaceId: 'ws-1',
      workspaceRole: 'member',
    } as any);

    await expect(
      caller.updateDocument({ id: 'doc-1', parentId: 'view-only-folder' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(mocks.findById).toHaveBeenCalledWith('doc-1');
    expect(mocks.assertCanEditResource).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        resourceId: 'old-parent',
        resourceType: 'document',
        workspaceId: 'ws-1',
      }),
    );
    expect(mocks.assertCanEditResource).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        resourceId: 'view-only-folder',
        resourceType: 'document',
        workspaceId: 'ws-1',
      }),
    );
    expect(mocks.updateDocument).not.toHaveBeenCalled();
  });

  it('checks edit access on the source parent when detaching a document (parentId: null)', async () => {
    mocks.assertCanEditResource
      .mockResolvedValueOnce(undefined) // the document itself
      .mockRejectedValueOnce(new TRPCError({ code: 'FORBIDDEN' })); // the current parent
    const caller = documentRouter.createCaller({
      serverDB: {},
      userId: 'member-1',
      workspaceId: 'ws-1',
      workspaceRole: 'member',
    } as any);

    await expect(caller.updateDocument({ id: 'doc-1', parentId: null })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    expect(mocks.assertCanEditResource).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ resourceId: 'old-parent', resourceType: 'document' }),
    );
    expect(mocks.updateDocument).not.toHaveBeenCalled();
  });

  it('does not re-check the parent when an ordinary update includes the current parent', async () => {
    const caller = documentRouter.createCaller({
      serverDB: {},
      userId: 'member-1',
      workspaceId: 'ws-1',
      workspaceRole: 'member',
    } as any);

    await caller.updateDocument({ id: 'doc-1', parentId: 'old-parent', title: 'Renamed' });

    expect(mocks.assertCanEditResource).toHaveBeenCalledTimes(1);
    expect(mocks.updateDocument).toHaveBeenCalledWith('doc-1', {
      editorData: undefined,
      parentId: 'old-parent',
      title: 'Renamed',
    });
  });
});
