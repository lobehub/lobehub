// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TransferErrorCode } from '@/types/transferError';

import { transferRouter } from './transfer';

const mocks = vi.hoisted(() => ({
  assertCanPerformResourceAction: vi.fn(),
  businessFileTransferStorageCheck: vi.fn(),
  documentCopyToWorkspace: vi.fn(),
  documentCountAddedStorageBytesInSubtree: vi.fn(),
  documentFindById: vi.fn(),
  documentTransferTo: vi.fn(),
  fileCopyToWorkspace: vi.fn(),
  fileFindById: vi.fn(),
  fileSumAddedStorageBytes: vi.fn(),
  fileTransferTo: vi.fn(),
  hasWorkspaceScopedPermission: vi.fn(),
  serverDB: {
    // Workspace-role lookups read `select().from().where().limit()`.
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([{ role: 'member' }]) })),
      })),
    })),
  },
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(() => mocks.serverDB) }));
vi.mock('@/business/server/lambda-routers/file', () => ({
  businessFileTransferStorageCheck: mocks.businessFileTransferStorageCheck,
}));
vi.mock('@/server/services/workspacePermission', () => ({
  hasWorkspaceScopedPermission: mocks.hasWorkspaceScopedPermission,
}));
vi.mock('@/server/services/resourcePermission', () => ({
  assertCanPerformResourceAction: mocks.assertCanPerformResourceAction,
}));
vi.mock('@/database/models/asyncTask', () => ({ AsyncTaskModel: vi.fn() }));
vi.mock('@/database/models/chunk', () => ({ ChunkModel: vi.fn() }));
vi.mock('@/database/models/knowledgeBase', () => ({ KnowledgeBaseModel: vi.fn() }));
vi.mock('@/database/repositories/knowledge', () => ({ KnowledgeRepo: vi.fn() }));
vi.mock('@/server/services/document', () => ({ DocumentService: vi.fn() }));
vi.mock('@/server/services/file', () => ({ FileService: vi.fn() }));
vi.mock('@/server/services/fileUpload', () => ({ FileUploadService: vi.fn() }));
vi.mock('@/database/models/document', () => ({
  DOCUMENT_TRANSFER_FOREIGN_ROWS: 'DOCUMENT_TRANSFER_FOREIGN_ROWS',
  DocumentModel: vi.fn(function () {
    return {
      copyToWorkspace: mocks.documentCopyToWorkspace,
      countAddedStorageBytesInSubtree: mocks.documentCountAddedStorageBytesInSubtree,
      findById: mocks.documentFindById,
      transferTo: mocks.documentTransferTo,
    };
  }),
}));
vi.mock('@/database/models/file', () => ({
  FileModel: Object.assign(
    vi.fn(function () {
      return {
        copyToWorkspace: mocks.fileCopyToWorkspace,
        findById: mocks.fileFindById,
        transferTo: mocks.fileTransferTo,
      };
    }),
    { sumAddedStorageBytes: mocks.fileSumAddedStorageBytes },
  ),
}));

const createCaller = (workspaceId?: string) =>
  transferRouter.createCaller({ userId: 'test-user', workspaceId } as any);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.businessFileTransferStorageCheck.mockResolvedValue(undefined);
  mocks.hasWorkspaceScopedPermission.mockResolvedValue(true);
});

describe('transferRouter.transferEntity', () => {
  it('should transfer document resources via documentModel', async () => {
    mocks.documentFindById.mockResolvedValue({ id: 'doc-1', userId: 'test-user' });
    mocks.documentCountAddedStorageBytesInSubtree.mockResolvedValue(4096);
    mocks.documentTransferTo.mockResolvedValue({ id: 'doc-1' });

    await createCaller('workspace-active').transferEntity({
      entityType: 'document',
      id: 'doc-1',
      targetWorkspaceId: null,
    });

    expect(mocks.assertCanPerformResourceAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'transfer',
        resourceId: 'doc-1',
        resourceType: 'document',
        userId: 'test-user',
        workspaceId: 'workspace-active',
      }),
    );
    expect(mocks.documentCountAddedStorageBytesInSubtree).toHaveBeenCalledWith('doc-1', {
      userId: 'test-user',
      workspaceId: null,
    });
    expect(mocks.businessFileTransferStorageCheck).toHaveBeenCalledWith({
      additionalSize: 4096,
      targetUserId: 'test-user',
      targetWorkspaceId: null,
    });
    expect(mocks.documentTransferTo).toHaveBeenCalledWith('doc-1', null, 'test-user', undefined, {
      forbidForeignRows: true,
    });
    expect(mocks.fileFindById).not.toHaveBeenCalled();
  });

  it('should check target storage before transferring a file resource', async () => {
    mocks.fileFindById.mockResolvedValue({ id: 'file-1', size: 2048 });
    mocks.fileSumAddedStorageBytes.mockResolvedValue(2048);
    mocks.fileTransferTo.mockResolvedValue({ fileId: 'file-1' });

    await createCaller().transferEntity({
      entityType: 'file',
      id: 'file-1',
      targetWorkspaceId: 'workspace-target',
    });

    expect(mocks.fileSumAddedStorageBytes).toHaveBeenCalledWith(
      mocks.serverDB,
      { userId: 'test-user', workspaceId: 'workspace-target' },
      ['file-1'],
    );
    expect(mocks.businessFileTransferStorageCheck).toHaveBeenCalledWith({
      additionalSize: 2048,
      targetUserId: 'test-user',
      targetWorkspaceId: 'workspace-target',
    });
    expect(mocks.fileTransferTo).toHaveBeenCalledWith(
      'file-1',
      'workspace-target',
      'test-user',
      undefined,
    );
  });

  it('should reject target workspace transfer when RBAC denies file upload', async () => {
    mocks.hasWorkspaceScopedPermission.mockResolvedValue(false);
    mocks.fileFindById.mockResolvedValue({ id: 'file-1', size: 2048 });

    await expect(
      createCaller().transferEntity({
        entityType: 'file',
        id: 'file-1',
        targetWorkspaceId: 'workspace-target',
      }),
    ).rejects.toMatchObject({ cause: { data: { code: TransferErrorCode.TargetNoWriteAccess } } });

    expect(mocks.businessFileTransferStorageCheck).not.toHaveBeenCalled();
    expect(mocks.fileTransferTo).not.toHaveBeenCalled();
  });
});

describe('transferRouter.copyEntityToWorkspace', () => {
  it('charges a copy only the bytes the target does not store yet', async () => {
    mocks.fileFindById.mockResolvedValue({ id: 'file-1', size: 2048 });
    // The target space already stores the file's object.
    mocks.fileSumAddedStorageBytes.mockResolvedValue(0);
    mocks.fileCopyToWorkspace.mockResolvedValue({ fileId: 'file-new' });

    await createCaller().copyEntityToWorkspace({
      entityType: 'file',
      id: 'file-1',
      targetWorkspaceId: null,
    });

    expect(mocks.fileSumAddedStorageBytes).toHaveBeenCalledWith(
      mocks.serverDB,
      { userId: 'test-user', workspaceId: null },
      ['file-1'],
    );
    expect(mocks.businessFileTransferStorageCheck).toHaveBeenCalledWith({
      additionalSize: 0,
      targetUserId: 'test-user',
      targetWorkspaceId: null,
    });
    expect(mocks.fileCopyToWorkspace).toHaveBeenCalledWith('file-1', null, 'test-user', undefined);
  });

  it('should copy document resources via documentModel', async () => {
    mocks.documentCopyToWorkspace.mockResolvedValue({ id: 'doc-1' });
    mocks.documentFindById.mockResolvedValue({ id: 'doc-1', userId: 'test-user' });
    mocks.documentCountAddedStorageBytesInSubtree.mockResolvedValue(4096);

    await createCaller().copyEntityToWorkspace({
      entityType: 'document',
      id: 'doc-1',
      targetWorkspaceId: null,
    });

    expect(mocks.documentCountAddedStorageBytesInSubtree).toHaveBeenCalledWith('doc-1', {
      userId: 'test-user',
      workspaceId: null,
    });
    expect(mocks.businessFileTransferStorageCheck).toHaveBeenCalledWith({
      additionalSize: 4096,
      targetUserId: 'test-user',
      targetWorkspaceId: null,
    });
    expect(mocks.documentCopyToWorkspace).toHaveBeenCalledWith(
      'doc-1',
      null,
      'test-user',
      undefined,
    );
    expect(mocks.fileFindById).not.toHaveBeenCalled();
  });
});
