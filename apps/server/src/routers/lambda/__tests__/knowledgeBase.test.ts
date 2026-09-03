import { beforeEach, describe, expect, it, vi } from 'vitest';

import { knowledgeBaseRouter } from '@/server/routers/lambda/knowledgeBase';
import { TransferErrorCode } from '@/types/transferError';

const routerMocks = vi.hoisted(() => ({
  assertContentsNotInRestrictedKnowledgeBase: vi.fn(),
  assertKnowledgeBaseBrowsable: vi.fn(),
  assertCanPerformResourceAction: vi.fn(),
  businessFileTransferStorageCheck: vi.fn(),
  hasWorkspaceScopedPermission: vi.fn(),
}));

const mockKnowledgeBaseModelCountFileUsage = vi.fn();
const mockKnowledgeBaseModelAddFiles = vi.fn();
const mockKnowledgeBaseModelCopyToWorkspace = vi.fn();
const mockKnowledgeBaseModelDeleteWithFiles = vi.fn();
const mockKnowledgeBaseModelFindById = vi.fn();
const mockKnowledgeBaseModelQuery = vi.fn();
const mockKnowledgeBaseModelRemoveFiles = vi.fn();
const mockKnowledgeBaseModelTransferTo = vi.fn();
const mockKnowledgeBaseModelHasForeignLinkedRows = vi.fn().mockResolvedValue(false);
const mockKnowledgeBaseModelUpdate = vi.fn();
const mockDocumentModelFindByIds = vi.fn();
const mockFileModelFindByIds = vi.fn();

vi.mock('@/business/server/lambda-routers/file', () => ({
  businessFileTransferStorageCheck: routerMocks.businessFileTransferStorageCheck,
}));

vi.mock('@/server/services/workspacePermission', () => ({
  hasWorkspaceScopedPermission: routerMocks.hasWorkspaceScopedPermission,
}));

vi.mock('@/server/services/resourcePermission', () => ({
  assertCanPerformResourceAction: routerMocks.assertCanPerformResourceAction,
}));

vi.mock('@/server/routers/lambda/_helpers/knowledgeBaseAccess', () => ({
  assertContentsNotInRestrictedKnowledgeBase:
    routerMocks.assertContentsNotInRestrictedKnowledgeBase,
  assertKnowledgeBaseBrowsable: routerMocks.assertKnowledgeBaseBrowsable,
  filterRestrictedKnowledgeBases: vi.fn(async (_ctx, items) => items),
  getUseLevelKnowledgeBaseIds: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/database/models/document', () => ({
  DocumentModel: vi.fn(() => ({ findByIds: mockDocumentModelFindByIds })),
}));

vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(() => ({ findByIds: mockFileModelFindByIds })),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(() => ({ deleteFiles: vi.fn() })),
}));

const mockPermissionRemoveAll = vi.fn();
const mockPermissionSetAccessLevel = vi.fn();
vi.mock('@/database/models/resourcePermission', () => ({
  ResourcePermissionModel: vi.fn(() => ({
    removeAll: mockPermissionRemoveAll,
    setAccessLevel: mockPermissionSetAccessLevel,
  })),
}));

vi.mock('@/database/models/knowledgeBase', () => ({
  KnowledgeBaseModel: vi.fn(() => ({
    addFilesToKnowledgeBase: mockKnowledgeBaseModelAddFiles,
    copyToWorkspace: mockKnowledgeBaseModelCopyToWorkspace,
    countFileUsage: mockKnowledgeBaseModelCountFileUsage,
    deleteWithFiles: mockKnowledgeBaseModelDeleteWithFiles,
    findById: mockKnowledgeBaseModelFindById,
    hasForeignLinkedRows: mockKnowledgeBaseModelHasForeignLinkedRows,
    query: mockKnowledgeBaseModelQuery,
    removeFilesFromKnowledgeBase: mockKnowledgeBaseModelRemoveFiles,
    transferTo: mockKnowledgeBaseModelTransferTo,
    update: mockKnowledgeBaseModelUpdate,
  })),
}));

describe('knowledgeBaseRouter', () => {
  const ctx = {
    serverDB: {},
    userId: 'test-user',
    workspaceId: 'workspace-active',
    workspaceRole: 'member',
  };

  const caller = knowledgeBaseRouter.createCaller(ctx as any);

  beforeEach(() => {
    vi.clearAllMocks();
    routerMocks.assertContentsNotInRestrictedKnowledgeBase.mockResolvedValue(undefined);
    routerMocks.assertKnowledgeBaseBrowsable.mockResolvedValue(undefined);
    routerMocks.assertCanPerformResourceAction.mockResolvedValue(undefined);
    routerMocks.businessFileTransferStorageCheck.mockResolvedValue(undefined);
    routerMocks.hasWorkspaceScopedPermission.mockResolvedValue(true);
    mockKnowledgeBaseModelCopyToWorkspace.mockResolvedValue({ id: 'kb-copy' });
    mockKnowledgeBaseModelCountFileUsage.mockResolvedValue(4096);
    mockKnowledgeBaseModelDeleteWithFiles.mockResolvedValue({ deletedFiles: [] });
    mockKnowledgeBaseModelFindById.mockResolvedValue({
      id: 'kb-1',
      userId: 'test-user',
      visibility: 'public',
      workspaceId: 'workspace-active',
    });
    mockKnowledgeBaseModelQuery.mockResolvedValue([]);
    mockKnowledgeBaseModelTransferTo.mockResolvedValue({ id: 'kb-1' });
    mockKnowledgeBaseModelUpdate.mockResolvedValue({ id: 'kb-1' });
  });

  describe('updateKnowledgeBase', () => {
    it("lets a member update another member's visible shared library", async () => {
      mockKnowledgeBaseModelFindById.mockResolvedValue({
        id: 'kb-1',
        userId: 'another-member',
        visibility: 'public',
        workspaceId: 'workspace-active',
      });

      await caller.updateKnowledgeBase({ id: 'kb-1', value: { name: 'Updated library' } });

      expect(routerMocks.assertKnowledgeBaseBrowsable).toHaveBeenCalledWith(
        expect.anything(),
        'kb-1',
        expect.objectContaining({ userId: 'another-member', visibility: 'public' }),
      );
      expect(mockKnowledgeBaseModelUpdate).toHaveBeenCalledWith('kb-1', {
        name: 'Updated library',
      });
    });

    // Regression: the input used to be `insertKnowledgeBasesSchema.partial()`,
    // so a member with collaborative `edit` access could reassign the row, move
    // it to another workspace, or take it private through the rename endpoint.
    it('drops identity and scope fields from the update payload', async () => {
      mockKnowledgeBaseModelFindById.mockResolvedValue({
        id: 'kb-1',
        userId: 'another-member',
        visibility: 'public',
        workspaceId: 'workspace-active',
      });

      await caller.updateKnowledgeBase({
        id: 'kb-1',
        value: {
          description: 'New description',
          id: 'hijacked-id',
          name: 'Updated library',
          userId: 'test-user',
          visibility: 'private',
          workspaceId: 'other-workspace',
        },
      } as Parameters<typeof caller.updateKnowledgeBase>[0]);

      expect(mockKnowledgeBaseModelUpdate).toHaveBeenCalledWith('kb-1', {
        description: 'New description',
        name: 'Updated library',
      });
    });

    it('does not update a restricted library that the member cannot browse', async () => {
      routerMocks.assertKnowledgeBaseBrowsable.mockRejectedValue(new Error('denied'));

      await expect(
        caller.updateKnowledgeBase({ id: 'kb-1', value: { name: 'Updated library' } }),
      ).rejects.toThrow('denied');

      expect(mockKnowledgeBaseModelUpdate).not.toHaveBeenCalled();
    });
  });

  describe('addFilesToKnowledgeBase', () => {
    it("lets a member add another creator's visible resource", async () => {
      mockFileModelFindByIds.mockResolvedValue([{ id: 'file-1', visibility: 'public' }]);
      mockDocumentModelFindByIds.mockResolvedValue([]);
      mockKnowledgeBaseModelAddFiles.mockResolvedValue([{ fileId: 'file-1' }]);

      await caller.addFilesToKnowledgeBase({ ids: ['file-1'], knowledgeBaseId: 'kb-1' });

      expect(mockKnowledgeBaseModelAddFiles).toHaveBeenCalledWith('kb-1', ['file-1']);
    });

    it('rejects assigning a resource to a library with different visibility', async () => {
      mockFileModelFindByIds.mockResolvedValue([{ id: 'file-1', visibility: 'private' }]);
      mockDocumentModelFindByIds.mockResolvedValue([]);

      await expect(
        caller.addFilesToKnowledgeBase({ ids: ['file-1'], knowledgeBaseId: 'kb-1' }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

      expect(mockKnowledgeBaseModelAddFiles).not.toHaveBeenCalled();
    });

    it('fails the whole batch when any resource is inaccessible', async () => {
      mockFileModelFindByIds.mockResolvedValue([{ id: 'file-1', visibility: 'public' }]);
      mockDocumentModelFindByIds.mockResolvedValue([]);

      await expect(
        caller.addFilesToKnowledgeBase({
          ids: ['file-1', 'private-file'],
          knowledgeBaseId: 'kb-1',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(mockKnowledgeBaseModelAddFiles).not.toHaveBeenCalled();
    });
  });

  describe('removeKnowledgeBase', () => {
    it("lets a member delete another creator's visible library", async () => {
      mockKnowledgeBaseModelFindById.mockResolvedValue({
        id: 'kb-1',
        userId: 'another-member',
        visibility: 'public',
        workspaceId: 'workspace-active',
      });

      await caller.removeKnowledgeBase({ id: 'kb-1' });

      expect(mockKnowledgeBaseModelDeleteWithFiles).toHaveBeenCalledWith(
        'kb-1',
        expect.any(Boolean),
      );
    });
  });

  describe('transferKnowledgeBase', () => {
    it('checks target storage before transferring a library', async () => {
      await caller.transferKnowledgeBase({
        id: 'kb-1',
        targetWorkspaceId: null,
      });

      expect(mockKnowledgeBaseModelCountFileUsage).toHaveBeenCalledWith('kb-1');
      expect(routerMocks.businessFileTransferStorageCheck).toHaveBeenCalledWith({
        additionalSize: 4096,
        targetUserId: 'test-user',
        targetWorkspaceId: null,
      });
      expect(mockKnowledgeBaseModelTransferTo).toHaveBeenCalledWith(
        'kb-1',
        null,
        'test-user',
        undefined,
      );
    });

    it('returns a stable error code when the library no longer exists', async () => {
      mockKnowledgeBaseModelFindById.mockResolvedValue(undefined);

      await expect(
        caller.transferKnowledgeBase({
          id: 'missing-kb',
          targetWorkspaceId: null,
        }),
      ).rejects.toMatchObject({
        cause: {
          data: {
            code: TransferErrorCode.ResourceNotFound,
          },
        },
      });
    });
  });

  describe('transferKnowledgeBase permission rows', () => {
    it('removes the source-workspace row and seeds the default level in a public target', async () => {
      await caller.transferKnowledgeBase({
        id: 'kb-1',
        targetVisibility: 'public',
        targetWorkspaceId: 'workspace-target',
      });

      expect(mockPermissionRemoveAll).toHaveBeenCalledWith('knowledgeBase', 'kb-1');
      expect(mockPermissionSetAccessLevel).toHaveBeenCalledWith(
        'knowledgeBase',
        'kb-1',
        'edit',
        'test-user',
      );
    });

    it('only clears the source row when moving to personal scope', async () => {
      await caller.transferKnowledgeBase({
        id: 'kb-1',
        targetWorkspaceId: null,
      });

      expect(mockPermissionRemoveAll).toHaveBeenCalledWith('knowledgeBase', 'kb-1');
      expect(mockPermissionSetAccessLevel).not.toHaveBeenCalled();
    });
  });

  describe('copyKnowledgeBaseToWorkspace', () => {
    it('checks target storage before copying a library', async () => {
      await caller.copyKnowledgeBaseToWorkspace({
        id: 'kb-1',
        targetWorkspaceId: null,
      });

      expect(mockKnowledgeBaseModelCountFileUsage).toHaveBeenCalledWith('kb-1');
      expect(routerMocks.businessFileTransferStorageCheck).toHaveBeenCalledWith({
        additionalSize: 4096,
        targetUserId: 'test-user',
        targetWorkspaceId: null,
      });
      expect(mockKnowledgeBaseModelCopyToWorkspace).toHaveBeenCalledWith(
        'kb-1',
        null,
        'test-user',
        undefined,
      );
    });

    it("rejects copying another member's library before any target or storage side effects", async () => {
      mockKnowledgeBaseModelFindById.mockResolvedValue({
        id: 'kb-1',
        userId: 'another-member',
      });

      await expect(
        caller.copyKnowledgeBaseToWorkspace({
          id: 'kb-1',
          targetWorkspaceId: 'workspace-target',
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      expect(routerMocks.hasWorkspaceScopedPermission).not.toHaveBeenCalled();
      expect(mockKnowledgeBaseModelCountFileUsage).not.toHaveBeenCalled();
      expect(routerMocks.businessFileTransferStorageCheck).not.toHaveBeenCalled();
      expect(mockKnowledgeBaseModelCopyToWorkspace).not.toHaveBeenCalled();
    });

    it('rejects target workspace copy when RBAC denies knowledge base creation', async () => {
      routerMocks.hasWorkspaceScopedPermission.mockResolvedValue(false);

      await expect(
        caller.copyKnowledgeBaseToWorkspace({
          id: 'kb-1',
          targetWorkspaceId: 'workspace-target',
        }),
      ).rejects.toMatchObject({
        cause: {
          data: {
            code: TransferErrorCode.TargetNoWriteAccess,
          },
        },
      });

      expect(routerMocks.businessFileTransferStorageCheck).not.toHaveBeenCalled();
      expect(mockKnowledgeBaseModelCopyToWorkspace).not.toHaveBeenCalled();
    });
  });
});
