import { MAX_UPLOAD_FILE_SIZE, UPLOAD_FILE_SIZE_LIMIT_ERROR_MESSAGE } from '@lobechat/const';
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KnowledgeRepo } from '@/database/repositories/knowledge';
import { fileRouter } from '@/server/routers/lambda/file';
import { AsyncTaskStatus } from '@/types/asyncTask';
import { FileSource } from '@/types/files';
import { TransferErrorCode } from '@/types/transferError';

const buildMockFileAccessUrl = ({ id }: { id: string }) => `https://lobehub.com/f/${id}`;

const routerMocks = vi.hoisted(() => {
  const transactionClient = {};

  return {
    businessFileUploadCheck: vi.fn(),
    businessFileTransferStorageCheck: vi.fn(),
    hasWorkspaceScopedPermission: vi.fn(),
    serverDB: {
      // `where` doubles as an awaitable empty result (restricted-KB lookups)
      // and as a `.limit()` chain (workspace-role lookups).
      select: vi.fn(() => ({
        from: vi.fn(() => {
          const whereResult = () =>
            Object.assign(Promise.resolve([]), {
              limit: vi.fn().mockResolvedValue([{ role: 'member' }]),
            });
          return {
            innerJoin: vi.fn(() => ({ where: vi.fn(whereResult) })),
            where: vi.fn(whereResult),
          };
        }),
      })),
      transaction: vi.fn(async (callback: (trx: unknown) => unknown) =>
        callback(transactionClient),
      ),
    },
    transactionClient,
  };
});

// Patch: Use actual router context middleware to inject the correct models/services
function createCallerWithCtx(partialCtx: any = {}) {
  // All mocks are spies
  const fileModel = {
    checkHash: vi.fn().mockResolvedValue({ isExist: true }),
    create: vi.fn().mockResolvedValue({ id: 'test-id' }),
    findById: vi.fn().mockResolvedValue(undefined),
    findByIds: vi.fn().mockResolvedValue([]),
    query: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
    deleteUnreferenced: vi.fn().mockResolvedValue(undefined),
    deleteMany: vi.fn().mockResolvedValue([]),
    updateGlobalFile: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue({} as any),
  };

  const fileService = {
    getFileContent: vi.fn().mockResolvedValue(''),
    getFileAccessUrl: vi.fn(async (file: { id: string }) => buildMockFileAccessUrl(file)),
    getFullFileUrl: vi.fn().mockResolvedValue('full-url'),
    getFileMetadata: vi.fn().mockResolvedValue({ contentLength: 2048, contentType: 'text/plain' }),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    deleteFiles: vi.fn().mockResolvedValue(undefined),
  };

  const chunkModel = {
    countByFileIds: vi.fn().mockResolvedValue([{ id: 'test-id', count: 5 }]),
    countByFileId: vi.fn().mockResolvedValue(5),
  };

  const asyncTaskModel = {
    findByIds: vi.fn().mockResolvedValue([
      {
        id: 'test-task-id',
        status: AsyncTaskStatus.Success,
      },
    ]),
    findById: vi.fn(),
    delete: vi.fn(),
  };

  const knowledgeRepo = {
    query: vi.fn().mockResolvedValue([]),
  };

  const documentModel = {};
  const documentService = {
    deleteDocuments: vi.fn().mockResolvedValue(undefined),
  };

  const ctx = {
    serverDB: {
      // Same dual-shape `where` as the module-level mock above.
      select: vi.fn(() => ({
        from: vi.fn(() => {
          const whereResult = () =>
            Object.assign(Promise.resolve([]), {
              limit: vi.fn().mockResolvedValue([{ role: 'member' }]),
            });
          return {
            innerJoin: vi.fn(() => ({ where: vi.fn(whereResult) })),
            where: vi.fn(whereResult),
          };
        }),
      })),
    } as any,
    userId: 'test-user',
    asyncTaskModel,
    chunkModel,
    documentModel,
    documentService,
    fileModel,
    fileService,
    knowledgeRepo,
    ...partialCtx,
  };

  return { ctx, caller: fileRouter.createCaller(ctx) };
}

vi.mock('@/config/db', () => ({
  serverDBEnv: {
    REMOVE_GLOBAL_FILE: false,
  },
}));

vi.mock('@/envs/app', () => ({
  appEnv: {
    APP_URL: 'https://lobehub.com',
  },
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => routerMocks.serverDB),
}));

vi.mock('@/business/server/lambda-routers/file', () => ({
  businessFileTransferStorageCheck: routerMocks.businessFileTransferStorageCheck,
  businessFileUploadCheck: routerMocks.businessFileUploadCheck,
}));

vi.mock('@/server/services/workspacePermission', () => ({
  hasWorkspaceScopedPermission: routerMocks.hasWorkspaceScopedPermission,
}));

const mockAsyncTaskFindByIds = vi.fn();
const mockAsyncTaskFindById = vi.fn();
const mockAsyncTaskDelete = vi.fn();
const mockChunkCountByFileIds = vi.fn();
const mockChunkCountByFileId = vi.fn();

vi.mock('@/database/models/asyncTask', () => ({
  AsyncTaskModel: vi.fn(() => ({
    delete: mockAsyncTaskDelete,
    findById: mockAsyncTaskFindById,
    findByIds: mockAsyncTaskFindByIds,
  })),
}));

vi.mock('@/database/models/chunk', () => ({
  ChunkModel: vi.fn(() => ({
    countByFileId: mockChunkCountByFileId,
    countByFileIds: mockChunkCountByFileIds,
  })),
}));

const mockFileModelCheckHash = vi.fn();
const mockFileModelCreate = vi.fn();
const mockFileModelDelete = vi.fn();
const mockFileModelDeleteUnreferenced = vi.fn();
const mockFileModelDeleteMany = vi.fn();
const mockFileModelFindById = vi.fn();
const mockFileModelFindByIds = vi.fn();
const mockFileModelQuery = vi.fn();
const mockFileModelUpdate = vi.fn();
const mockFileModelUpdateGlobalFile = vi.fn();
const mockFileModelClear = vi.fn();
const mockFileModelTransferTo = vi.fn();
const mockFileModelCopyToWorkspace = vi.fn();

vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(() => ({
    checkHash: mockFileModelCheckHash,
    create: mockFileModelCreate,
    delete: mockFileModelDelete,
    deleteUnreferenced: mockFileModelDeleteUnreferenced,
    deleteMany: mockFileModelDeleteMany,
    findById: mockFileModelFindById,
    findByIds: mockFileModelFindByIds,
    query: mockFileModelQuery,
    update: mockFileModelUpdate,
    updateGlobalFile: mockFileModelUpdateGlobalFile,
    clear: mockFileModelClear,
    copyToWorkspace: mockFileModelCopyToWorkspace,
    transferTo: mockFileModelTransferTo,
  })),
}));

const mockKnowledgeBaseFindById = vi.fn();

vi.mock('@/database/models/knowledgeBase', () => ({
  KnowledgeBaseModel: vi.fn(() => ({
    findById: mockKnowledgeBaseFindById,
  })),
}));

const mockFileServiceGetFullFileUrl = vi.fn();
const mockFileServiceGetFileContent = vi.fn();
const mockFileServiceGetFileAccessUrl = vi.fn();
const mockFileServiceGetFileMetadata = vi.fn();
const mockFileServiceDeleteFile = vi.fn();

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(() => ({
    deleteFile: mockFileServiceDeleteFile,
    deleteFiles: vi.fn(),
    getFileAccessUrl: mockFileServiceGetFileAccessUrl,
    getFileContent: mockFileServiceGetFileContent,
    getFullFileUrl: mockFileServiceGetFullFileUrl,
    getFileMetadata: mockFileServiceGetFileMetadata,
  })),
}));

const mockKnowledgeRepoQuery = vi.fn().mockResolvedValue([]);
const mockDocumentServiceDeleteDocuments = vi.fn();
const mockDocumentModelCountFileUsageInSubtree = vi.fn();
const mockDocumentModelCopyToWorkspace = vi.fn();
const mockDocumentModelFindById = vi.fn();
const mockDocumentModelFindBySlug = vi.fn();
const mockDocumentModelTransferTo = vi.fn();
const mockDocumentModelSubtreeHasForeignRows = vi.fn().mockResolvedValue(false);

vi.mock('@/database/repositories/knowledge', () => ({
  KnowledgeRepo: vi.fn(() => ({
    query: mockKnowledgeRepoQuery,
  })),
}));

vi.mock('@/database/models/document', () => ({
  DocumentModel: vi.fn(() => ({
    countFileUsageInSubtree: mockDocumentModelCountFileUsageInSubtree,
    copyToWorkspace: mockDocumentModelCopyToWorkspace,
    findById: mockDocumentModelFindById,
    findBySlug: mockDocumentModelFindBySlug,
    subtreeHasForeignRows: mockDocumentModelSubtreeHasForeignRows,
    transferTo: mockDocumentModelTransferTo,
  })),
}));

vi.mock('@/server/services/document', () => ({
  DocumentService: vi.fn(() => ({
    deleteDocuments: mockDocumentServiceDeleteDocuments,
  })),
}));

const mockAssertCanPerformResourceAction = vi.hoisted(() => vi.fn());

vi.mock('@/server/services/resourcePermission', () => ({
  assertCanPerformResourceAction: mockAssertCanPerformResourceAction,
}));

describe('fileRouter', () => {
  let ctx: any;
  let caller: any;
  let mockFile: any;

  beforeEach(() => {
    vi.clearAllMocks();
    routerMocks.businessFileUploadCheck.mockResolvedValue(undefined);
    routerMocks.businessFileTransferStorageCheck.mockResolvedValue(undefined);
    routerMocks.hasWorkspaceScopedPermission.mockResolvedValue(true);
    mockKnowledgeBaseFindById.mockResolvedValue({ id: 'kb-1', visibility: 'public' });
    mockDocumentModelFindById.mockResolvedValue(undefined);
    mockDocumentModelFindBySlug.mockResolvedValue(undefined);

    mockFile = {
      id: 'test-id',
      name: 'test.txt',
      url: 'test-url',
      createdAt: new Date(),
      updatedAt: new Date(),
      accessedAt: new Date(),
      userId: 'test-user',
      size: 100,
      fileType: 'text',
      metadata: {},
      fileHash: null,
      clientId: null,
      chunkTaskId: null,
      embeddingTaskId: null,
    };

    // Set default mock for getFileMetadata (security fix for GHSA-wrrr-8jcv-wjf5)
    mockFileServiceGetFileMetadata.mockResolvedValue({
      contentLength: 100,
      contentType: 'text/plain',
    });
    mockFileServiceGetFileAccessUrl.mockImplementation(async (file: { id: string }) =>
      buildMockFileAccessUrl(file),
    );

    // Use actual context with default mocks
    ({ ctx, caller } = createCallerWithCtx());
  });

  describe('checkFileHash', () => {
    it('should handle when fileModel.checkHash returns undefined', async () => {
      ctx.fileModel.checkHash.mockResolvedValue(undefined);
      await expect(caller.checkFileHash({ hash: 'test-hash' })).resolves.toBeUndefined();
    });

    it('should return existing hash when the stored object is still available', async () => {
      const checkResult = {
        isExist: true,
        metadata: { path: 'files/existing.png' },
        url: 'files/existing.png',
      };
      mockFileModelCheckHash.mockResolvedValue(checkResult);
      mockFileServiceGetFileMetadata.mockResolvedValue({
        contentLength: 100,
        contentType: 'image/png',
      });

      await expect(caller.checkFileHash({ hash: 'test-hash' })).resolves.toEqual(checkResult);

      expect(mockFileServiceGetFileMetadata).toHaveBeenCalledWith('files/existing.png');
    });

    it('should treat stale hash records as missing when the stored object is unavailable', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockFileModelCheckHash.mockResolvedValue({
        isExist: true,
        metadata: { path: 'generations/images/missing_raw.jpg' },
        url: 'generations/images/missing_raw.jpg',
      });
      mockFileServiceGetFileMetadata.mockRejectedValue(new Error('NoSuchKey'));

      await expect(caller.checkFileHash({ hash: 'test-hash' })).resolves.toEqual({
        isExist: false,
      });

      expect(mockFileServiceGetFileMetadata).toHaveBeenCalledWith(
        'generations/images/missing_raw.jpg',
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to verify existing file hash storage object:',
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });
  });

  describe('createFile', () => {
    it('should throw if fileModel.checkHash returns undefined', async () => {
      ctx.fileModel.checkHash.mockResolvedValue(undefined);
      await expect(
        caller.createFile({
          hash: 'test-hash',
          fileType: 'text',
          name: 'test.txt',
          size: 100,
          url: 'test-url',
          metadata: {},
        }),
      ).rejects.toThrow();
    });

    it('should reject a parent document that is not accessible', async () => {
      mockFileModelCheckHash.mockResolvedValue({ isExist: false });

      await expect(
        caller.createFile({
          fileType: 'text',
          hash: 'test-hash',
          metadata: {},
          name: 'test.txt',
          parentId: 'foreign-folder',
          size: 100,
          url: 'test-url',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(mockFileModelCreate).not.toHaveBeenCalled();
    });

    it('should return proxy URL format ${APP_URL}/f/:id', async () => {
      mockFileModelCheckHash.mockResolvedValue({ isExist: false });
      mockFileModelCreate.mockResolvedValue({ id: 'new-file-id' });

      const result = await caller.createFile({
        hash: 'test-hash',
        fileType: 'text',
        name: 'test.txt',
        size: 100,
        url: 'files/test.txt',
        metadata: {},
      });

      expect(result).toEqual({
        id: 'new-file-id',
        url: 'https://lobehub.com/f/new-file-id',
      });
    });

    it('should persist a known upload source so the origin filter can see it', async () => {
      mockFileModelCheckHash.mockResolvedValue({ isExist: false });
      mockFileModelCreate.mockResolvedValue({ id: 'new-file-id' });

      await caller.createFile({
        hash: 'test-hash',
        fileType: 'image/png',
        metadata: {},
        name: 'pasted.png',
        size: 100,
        source: FileSource.PageEditor,
        url: 'files/pasted.png',
      });

      expect(mockFileModelCreate).toHaveBeenCalledWith(
        expect.objectContaining({ source: FileSource.PageEditor }),
        true,
        routerMocks.transactionClient,
      );
    });

    it('should drop an unrecognised source instead of failing the upload', async () => {
      mockFileModelCheckHash.mockResolvedValue({ isExist: false });
      mockFileModelCreate.mockResolvedValue({ id: 'new-file-id' });

      await caller.createFile({
        hash: 'test-hash',
        fileType: 'image/png',
        metadata: {},
        name: 'pasted.png',
        size: 100,
        source: 'some-future-client',
        url: 'files/pasted.png',
      });

      expect(mockFileModelCreate).toHaveBeenCalledWith(
        expect.objectContaining({ source: undefined }),
        true,
        routerMocks.transactionClient,
      );
    });

    it('should refresh global file metadata when an existing hash points to a missing object', async () => {
      mockFileModelCheckHash.mockResolvedValue({
        isExist: true,
        metadata: { path: 'old/path.txt' },
        url: 'old/path.txt',
      });
      mockFileModelCreate.mockResolvedValue({ id: 'new-file-id' });
      mockFileServiceGetFileMetadata
        .mockResolvedValueOnce({ contentLength: 100, contentType: 'text/plain' })
        .mockRejectedValueOnce(new Error('NoSuchKey'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await caller.createFile({
        hash: 'test-hash',
        fileType: 'text',
        metadata: { path: 'new/path.txt' },
        name: 'test.txt',
        size: 100,
        url: 'new/path.txt',
      });

      expect(mockFileModelUpdateGlobalFile).toHaveBeenCalledWith(
        'test-hash',
        {
          metadata: { path: 'new/path.txt' },
          url: 'new/path.txt',
        },
        routerMocks.transactionClient,
      );
      expect(mockFileModelCreate).toHaveBeenCalledWith(
        expect.objectContaining({ fileHash: 'test-hash', url: 'new/path.txt' }),
        false,
        routerMocks.transactionClient,
      );
      consoleSpy.mockRestore();
    });

    it('should keep the global file pointer when an existing hash object is still available', async () => {
      mockFileModelCheckHash.mockResolvedValue({
        isExist: true,
        metadata: { path: 'old/path.txt' },
        url: 'old/path.txt',
      });
      mockFileModelCreate.mockResolvedValue({ id: 'new-file-id' });
      mockFileServiceGetFileMetadata.mockResolvedValue({
        contentLength: 100,
        contentType: 'text/plain',
      });

      await caller.createFile({
        hash: 'test-hash',
        fileType: 'text',
        metadata: { path: 'new/path.txt' },
        name: 'test.txt',
        size: 100,
        url: 'new/path.txt',
      });

      expect(mockFileModelUpdateGlobalFile).not.toHaveBeenCalled();
      expect(mockFileModelCreate).toHaveBeenCalledWith(
        expect.objectContaining({ fileHash: 'test-hash', url: 'new/path.txt' }),
        false,
        routerMocks.transactionClient,
      );
    });

    it('should run business upload check and file creation in the same transaction', async () => {
      mockFileModelCheckHash.mockResolvedValue({ isExist: false });
      mockFileModelCreate.mockResolvedValue({ id: 'new-file-id' });

      await caller.createFile({
        hash: 'test-hash',
        fileType: 'text',
        name: 'test.txt',
        size: 100,
        url: 'files/test.txt',
        metadata: {},
      });

      expect(routerMocks.serverDB.transaction).toHaveBeenCalledTimes(1);
      expect(routerMocks.businessFileUploadCheck).toHaveBeenCalledWith(
        expect.objectContaining({
          actualSize: 100,
          transaction: routerMocks.transactionClient,
        }),
      );
      expect(mockFileModelCreate).toHaveBeenCalledWith(
        expect.objectContaining({ size: 100 }),
        true,
        routerMocks.transactionClient,
      );
    });

    it('should pass workspace context into business upload check', async () => {
      ({ caller } = createCallerWithCtx({ workspaceId: 'workspace-1' }));
      mockFileModelCheckHash.mockResolvedValue({ isExist: false });
      mockFileModelCreate.mockResolvedValue({ id: 'new-file-id' });

      await caller.createFile({
        hash: 'test-hash',
        fileType: 'text',
        name: 'test.txt',
        size: 100,
        url: 'files/test.txt',
        metadata: {},
      });

      expect(routerMocks.businessFileUploadCheck).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'workspace-1',
        }),
      );
    });

    it('should use workspace knowledge-base visibility over an explicit value', async () => {
      ({ caller } = createCallerWithCtx({ workspaceId: 'workspace-1' }));
      mockFileModelCheckHash.mockResolvedValue({ isExist: false });
      mockFileModelCreate.mockResolvedValue({ id: 'new-file-id' });

      await caller.createFile({
        hash: 'test-hash',
        fileType: 'text',
        knowledgeBaseId: 'kb-1',
        name: 'test.txt',
        size: 100,
        url: 'files/test.txt',
        visibility: 'private',
        metadata: {},
      });

      expect(mockKnowledgeBaseFindById).toHaveBeenCalledWith('kb-1');
      expect(mockFileModelCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          knowledgeBaseId: 'kb-1',
          visibility: 'public',
        }),
        true,
        routerMocks.transactionClient,
      );
    });

    it('should reject a workspace upload when the knowledge base is not accessible', async () => {
      ({ caller } = createCallerWithCtx({ workspaceId: 'workspace-1' }));
      mockFileModelCheckHash.mockResolvedValue({ isExist: false });
      mockKnowledgeBaseFindById.mockResolvedValue(undefined);

      await expect(
        caller.createFile({
          hash: 'test-hash',
          fileType: 'text',
          knowledgeBaseId: 'missing-kb',
          name: 'test.txt',
          size: 100,
          url: 'files/test.txt',
          metadata: {},
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(mockFileModelCreate).not.toHaveBeenCalled();
    });

    it('should use actual file size from S3 instead of client-provided size (security fix)', async () => {
      // Setup: S3 returns actual size of 5000 bytes
      mockFileServiceGetFileMetadata.mockResolvedValue({
        contentLength: 5000,
        contentType: 'text/plain',
      });
      mockFileModelCheckHash.mockResolvedValue({ isExist: false });
      mockFileModelCreate.mockResolvedValue({ id: 'new-file-id' });

      // Client claims file is only 100 bytes (attempting quota bypass)
      await caller.createFile({
        hash: 'test-hash',
        fileType: 'text',
        name: 'test.txt',
        size: 100, // Client-provided fake size
        url: 'files/test.txt',
        metadata: {},
      });

      // Verify getFileMetadata was called to get actual size
      expect(mockFileServiceGetFileMetadata).toHaveBeenCalledWith('files/test.txt');

      // Verify create was called with actual size from S3, not client-provided size
      expect(mockFileModelCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          size: 5000, // Actual size from S3, not 100
        }),
        true,
        routerMocks.transactionClient,
      );
    });

    it('should reject actual storage objects larger than the database size range', async () => {
      mockFileModelCheckHash.mockResolvedValue({ isExist: false });
      mockFileServiceGetFileMetadata.mockResolvedValue({
        contentLength: MAX_UPLOAD_FILE_SIZE + 1,
        contentType: 'application/octet-stream',
      });

      await expect(
        caller.createFile({
          hash: 'test-hash',
          fileType: 'application/octet-stream',
          metadata: {},
          name: 'huge.bin',
          size: 100,
          url: 'files/huge.bin',
        }),
      ).rejects.toMatchObject({
        code: 'PAYLOAD_TOO_LARGE',
        message: UPLOAD_FILE_SIZE_LIMIT_ERROR_MESSAGE,
      });

      expect(mockFileModelCreate).not.toHaveBeenCalled();
      expect(routerMocks.businessFileUploadCheck).not.toHaveBeenCalled();
    });

    it('should fallback to input size when getFileMetadata fails', async () => {
      mockFileModelCheckHash.mockResolvedValue({ isExist: false });
      mockFileModelCreate.mockResolvedValue({ id: 'new-file-id' });
      mockFileServiceGetFileMetadata.mockRejectedValue(new Error('File not found in S3'));

      const result = await caller.createFile({
        hash: 'test-hash',
        fileType: 'text',
        name: 'test.txt',
        size: 100,
        url: 'files/non-existent.txt',
        metadata: {},
      });

      expect(result).toEqual({
        id: 'new-file-id',
        url: 'https://lobehub.com/f/new-file-id',
      });

      // Verify create was called with input size as fallback
      expect(mockFileModelCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          size: 100,
        }),
        true,
        routerMocks.transactionClient,
      );
    });

    it('should throw error when getFileMetadata fails and input size is negative', async () => {
      mockFileModelCheckHash.mockResolvedValue({ isExist: false });
      mockFileServiceGetFileMetadata.mockRejectedValue(new Error('File not found in S3'));

      await expect(
        caller.createFile({
          hash: 'test-hash',
          fileType: 'text',
          name: 'test.txt',
          size: -1,
          url: 'files/non-existent.txt',
          metadata: {},
        }),
      ).rejects.toThrow('File size cannot be negative');
    });

    it('should use input size when getFileMetadata returns contentLength less than 1', async () => {
      mockFileModelCheckHash.mockResolvedValue({ isExist: false });
      mockFileModelCreate.mockResolvedValue({ id: 'new-file-id' });
      mockFileServiceGetFileMetadata.mockResolvedValue({
        contentLength: 0,
        contentType: 'text/plain',
      });

      await caller.createFile({
        hash: 'test-hash',
        fileType: 'text',
        name: 'test.txt',
        size: 100,
        url: 'files/test.txt',
        metadata: {},
      });

      // Verify create was called with input size since contentLength < 1
      expect(mockFileModelCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          size: 100,
        }),
        true,
        routerMocks.transactionClient,
      );
    });

    it('should throw error when both getFileMetadata contentLength and input size are negative', async () => {
      mockFileModelCheckHash.mockResolvedValue({ isExist: false });
      mockFileServiceGetFileMetadata.mockResolvedValue({
        contentLength: -1,
        contentType: 'text/plain',
      });

      await expect(
        caller.createFile({
          hash: 'test-hash',
          fileType: 'text',
          name: 'test.txt',
          size: -1,
          url: 'files/test.txt',
          metadata: {},
        }),
      ).rejects.toThrow('File size cannot be negative');
    });
  });

  describe('findById', () => {
    it('should throw error when file not found', async () => {
      ctx.fileModel.findById.mockResolvedValue(null);

      await expect(caller.findById({ id: 'invalid-id' })).rejects.toThrow(TRPCError);
    });

    it('should return proxy URL format ${APP_URL}/f/:id', async () => {
      mockFileModelFindById.mockResolvedValue(mockFile);

      const result = await caller.findById({ id: 'test-id' });

      expect(result.url).toBe('https://lobehub.com/f/test-id');
    });
  });

  describe('getFileItemById', () => {
    it('should throw error when file not found', async () => {
      mockFileModelFindById.mockResolvedValue(null);

      await expect(caller.getFileItemById({ id: 'invalid-id' })).rejects.toThrow(TRPCError);
    });

    it('should return proxy URL format ${APP_URL}/f/:id', async () => {
      mockFileModelFindById.mockResolvedValue(mockFile);

      const result = await caller.getFileItemById({ id: 'test-id' });

      expect(result?.url).toBe('https://lobehub.com/f/test-id');
    });
  });

  describe('getFiles', () => {
    it('should handle fileModel.query returning undefined', async () => {
      mockFileModelQuery.mockResolvedValue(undefined);

      await expect(caller.getFiles({})).rejects.toThrow();
    });

    it('should return proxy URL format ${APP_URL}/f/:id for each file', async () => {
      const files = [
        { ...mockFile, id: 'file-1' },
        { ...mockFile, id: 'file-2' },
      ];
      mockFileModelQuery.mockResolvedValue(files);
      mockChunkCountByFileIds.mockResolvedValue([
        { id: 'file-1', count: 5 },
        { id: 'file-2', count: 3 },
      ]);

      const result = await caller.getFiles({});

      expect(result).toHaveLength(2);
      expect(result[0].url).toBe('https://lobehub.com/f/file-1');
      expect(result[1].url).toBe('https://lobehub.com/f/file-2');
    });
  });

  describe('getKnowledgeItems', () => {
    it('should pass workspace context to the knowledge repository', async () => {
      ({ caller } = createCallerWithCtx({ workspaceId: 'workspace-1' }));

      await caller.getKnowledgeItems({});

      expect(KnowledgeRepo).toHaveBeenCalledWith(expect.anything(), 'test-user', 'workspace-1');
    });

    it('should reject preview pages larger than the server limit', async () => {
      await expect(
        caller.getKnowledgeItems({ includeContentPreview: true, limit: 101 }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

      expect(mockKnowledgeRepoQuery).not.toHaveBeenCalled();
      expect(mockFileServiceGetFileContent).not.toHaveBeenCalled();
    });

    it('should preserve full content for legacy clients that omit the preview contract', async () => {
      const knowledgeItems = [
        {
          ...mockFile,
          chunkTaskId: 'chunk-1',
          editorData: { large: 'derived document state' },
          embeddingTaskId: 'emb-1',
          id: 'file-1',
          sourceType: 'file' as const,
        },
        {
          editorData: { content: 'test' },
          id: 'doc-1',
          name: 'Document 1',
          sourceType: 'document' as const,
        },
      ];

      mockKnowledgeRepoQuery.mockResolvedValue(knowledgeItems);
      mockChunkCountByFileIds.mockResolvedValue([{ count: 10, id: 'file-1' }]);
      mockAsyncTaskFindByIds
        .mockResolvedValueOnce([{ error: null, id: 'chunk-1', status: AsyncTaskStatus.Success }])
        .mockResolvedValueOnce([{ error: null, id: 'emb-1', status: AsyncTaskStatus.Success }]);
      mockFileServiceGetFullFileUrl.mockResolvedValue('https://example.com/test-url');

      const result = await caller.getKnowledgeItems({});

      expect(result.items).toHaveLength(2);
      expect(result.hasMore).toBe(false);
      expect(result.items[0]).toMatchObject({
        chunkCount: 10,
        chunkingStatus: AsyncTaskStatus.Success,
        embeddingStatus: AsyncTaskStatus.Success,
        finishEmbedding: true,
        id: 'file-1',
        sourceType: 'file',
        url: 'https://lobehub.com/f/file-1',
      });
      expect(result.items[0].editorData).toBeNull();
      expect(result.items[1]).toMatchObject({
        chunkCount: null,
        chunkingError: null,
        chunkingStatus: null,
        editorData: { content: 'test' },
        embeddingError: null,
        embeddingStatus: null,
        finishEmbedding: false,
        id: 'doc-1',
        name: 'Document 1',
      });
      expect(mockKnowledgeRepoQuery).toHaveBeenCalledWith(
        expect.objectContaining({ includeContent: true, includeContentPreview: false }),
      );
    });

    it('should omit document bodies when a list explicitly requests metadata only', async () => {
      mockKnowledgeRepoQuery.mockResolvedValue([
        {
          ...mockFile,
          contentPreviewSource: 'must not leave the server',
          id: 'file-1',
          sourceType: 'file' as const,
        },
      ]);

      const result = await caller.getKnowledgeItems({ includeContentPreview: false });

      expect(mockKnowledgeRepoQuery).toHaveBeenCalledWith(
        expect.objectContaining({ includeContent: false, includeContentPreview: false }),
      );
      expect(result.items[0]).not.toHaveProperty('content');
      expect(result.items[0]).not.toHaveProperty('contentPreview');
      expect(result.items[0]).not.toHaveProperty('contentPreviewSource');
      expect(mockFileServiceGetFileContent).not.toHaveBeenCalled();
    });

    it('creates a server preview from a bounded storage prefix for unparsed Markdown', async () => {
      mockKnowledgeRepoQuery.mockResolvedValue([
        {
          ...mockFile,
          documentId: null,
          fileType: 'text/markdown',
          id: 'file-markdown',
          name: 'notes.md',
          sourceType: 'file' as const,
          url: 'files/notes.md',
        },
      ]);
      mockFileServiceGetFileContent.mockResolvedValue(
        '# Notes\n\nThis preview came from object storage.',
      );

      const result = await caller.getKnowledgeItems({ includeContentPreview: true });

      expect(mockFileServiceGetFileContent).toHaveBeenCalledWith('files/notes.md', 8192);
      expect(result.items[0]).toMatchObject({
        contentPreview: 'Notes This preview came from object storage.',
        id: 'file-markdown',
      });
      expect(result.items[0]).not.toHaveProperty('contentPreviewSource');
    });
  });

  describe('getKnowledgeItemStatusesByIds', () => {
    it('should return lightweight status fields in input order and skip missing ids', async () => {
      mockFileModelFindByIds.mockResolvedValue([
        {
          ...mockFile,
          chunkTaskId: null,
          embeddingTaskId: 'emb-2',
          id: 'file-2',
        },
        {
          ...mockFile,
          chunkTaskId: 'chunk-1',
          embeddingTaskId: 'emb-1',
          id: 'file-1',
        },
      ]);
      mockChunkCountByFileIds.mockResolvedValue([
        { count: 3, id: 'file-2' },
        { count: 10, id: 'file-1' },
      ]);
      mockAsyncTaskFindByIds
        .mockResolvedValueOnce([{ error: null, id: 'chunk-1', status: AsyncTaskStatus.Success }])
        .mockResolvedValueOnce([
          { error: null, id: 'emb-2', status: AsyncTaskStatus.Processing },
          { error: null, id: 'emb-1', status: AsyncTaskStatus.Success },
        ]);

      const result = await caller.getKnowledgeItemStatusesByIds({
        ids: ['file-2', 'missing-id', 'file-1'],
      });

      expect(result).toEqual([
        {
          chunkCount: 3,
          chunkingError: null,
          chunkingStatus: null,
          embeddingError: null,
          embeddingStatus: AsyncTaskStatus.Processing,
          finishEmbedding: false,
          id: 'file-2',
        },
        {
          chunkCount: 10,
          chunkingError: null,
          chunkingStatus: AsyncTaskStatus.Success,
          embeddingError: null,
          embeddingStatus: AsyncTaskStatus.Success,
          finishEmbedding: true,
          id: 'file-1',
        },
      ]);
    });
  });

  describe('removeFile', () => {
    it('should fail explicitly when file is not accessible', async () => {
      mockFileModelFindById.mockResolvedValue(undefined);

      await expect(caller.removeFile({ id: 'invalid-id' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });

      expect(ctx.fileService.deleteFile).not.toHaveBeenCalled();
    });

    it("lets a workspace member delete another creator's visible file", async () => {
      ({ ctx, caller } = createCallerWithCtx({
        workspaceId: 'workspace-active',
        workspaceRole: 'member',
      }));
      mockFileModelFindById.mockResolvedValue({ id: 'shared-file', userId: 'other-member' });
      mockFileModelDelete.mockResolvedValue({ url: 'files/shared.txt' });

      await caller.removeFile({ id: 'shared-file' });

      expect(mockFileModelDelete).toHaveBeenCalledWith('shared-file', false);
    });
  });

  describe('removeUnreferencedFile', () => {
    it('keeps object storage when the file became referenced before cleanup', async () => {
      mockFileModelFindById.mockResolvedValue({ id: 'voice-file', userId: 'test-user' });
      mockFileModelDeleteUnreferenced.mockResolvedValue(undefined);

      await caller.removeUnreferencedFile({ id: 'voice-file' });

      expect(mockFileModelDeleteUnreferenced).toHaveBeenCalledWith('voice-file', false);
      expect(mockFileServiceDeleteFile).not.toHaveBeenCalled();
    });

    it('removes object storage after the unreferenced database row is deleted', async () => {
      mockFileModelFindById.mockResolvedValue({ id: 'voice-file', userId: 'test-user' });
      mockFileModelDeleteUnreferenced.mockResolvedValue({ url: 'voice/file.webm' });

      await caller.removeUnreferencedFile({ id: 'voice-file' });

      expect(mockFileServiceDeleteFile).toHaveBeenCalledWith('voice/file.webm');
    });
  });

  describe('removeFiles', () => {
    it('should fail the whole request when any file is inaccessible', async () => {
      ctx.fileModel.deleteMany.mockResolvedValue([]);

      await expect(caller.removeFiles({ ids: ['invalid-1', 'invalid-2'] })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });

      expect(ctx.fileService.deleteFiles).not.toHaveBeenCalled();
    });
  });

  describe('updateFile', () => {
    it('should reject moving a file to a parent document that is not accessible', async () => {
      mockFileModelFindById.mockResolvedValue({ id: 'file-1', userId: 'other-member' });

      await expect(
        caller.updateFile({ id: 'file-1', parentId: 'foreign-folder' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(mockFileModelUpdate).not.toHaveBeenCalled();
    });

    it('should resolve and validate an accessible parent before moving a file', async () => {
      mockFileModelFindById.mockResolvedValue({ id: 'file-1', userId: 'other-member' });
      mockDocumentModelFindBySlug.mockResolvedValue({
        id: 'docs_parent',
        visibility: 'public',
      });

      await caller.updateFile({ id: 'file-1', parentId: 'parent-folder' });

      expect(mockFileModelUpdate).toHaveBeenCalledWith('file-1', { parentId: 'docs_parent' });
    });
  });

  describe('deleteKnowledgeItemsByQuery', () => {
    it('should delete page-backed knowledge items via documentService and plain files via fileModel', async () => {
      mockKnowledgeRepoQuery.mockResolvedValue([
        {
          documentId: 'doc-1',
          fileId: 'file-1',
          fileType: 'custom/page',
          id: 'doc-1',
          sourceType: 'file',
        },
        {
          documentId: null,
          fileId: 'file-2',
          fileType: 'text/plain',
          id: 'file-2',
          sourceType: 'file',
        },
      ]);
      mockFileModelDeleteMany.mockResolvedValue([]);

      const result = await caller.deleteKnowledgeItemsByQuery({});

      expect(mockDocumentServiceDeleteDocuments).toHaveBeenCalledWith(['doc-1']);
      expect(mockFileModelDeleteMany).toHaveBeenCalledWith(['file-2'], false);
      expect(result).toEqual({ count: 2 });
    });

    it('should let members delete the full visible query scope while honoring exclusions', async () => {
      ({ ctx, caller } = createCallerWithCtx({
        workspaceId: 'workspace-active',
        workspaceRole: 'member',
      }));
      mockKnowledgeRepoQuery.mockResolvedValue([
        {
          documentId: null,
          fileId: 'file-keep',
          fileType: 'text/plain',
          id: 'file-keep',
          sourceType: 'file',
        },
        {
          documentId: null,
          fileId: 'file-delete',
          fileType: 'text/plain',
          id: 'file-delete',
          sourceType: 'file',
        },
      ]);
      mockFileModelDeleteMany.mockResolvedValue([]);

      const result = await caller.deleteKnowledgeItemsByQuery({
        excludedIds: ['file-keep'],
      });

      expect(mockKnowledgeRepoQuery).toHaveBeenCalledWith({
        excludeKnowledgeBaseIds: [],
        includeContent: false,
        includeContentPreview: false,
        limit: 501,
        offset: 0,
        showFilesInKnowledgeBase: false,
      });
      expect(mockFileModelDeleteMany).toHaveBeenCalledWith(['file-delete'], false);
      expect(result).toEqual({ count: 1 });
    });

    it('should let workspace owners delete the full query scope', async () => {
      ({ ctx, caller } = createCallerWithCtx({
        workspaceId: 'workspace-active',
        workspaceRole: 'owner',
      }));
      mockKnowledgeRepoQuery.mockResolvedValue([
        {
          documentId: null,
          fileId: 'member-file',
          fileType: 'text/plain',
          id: 'member-file',
          sourceType: 'file',
        },
      ]);
      mockFileModelDeleteMany.mockResolvedValue([]);

      await caller.deleteKnowledgeItemsByQuery({});

      expect(mockKnowledgeRepoQuery).toHaveBeenCalledWith({
        excludeKnowledgeBaseIds: [],
        includeContent: false,
        includeContentPreview: false,
        limit: 501,
        offset: 0,
        showFilesInKnowledgeBase: false,
      });
      expect(mockFileModelDeleteMany).toHaveBeenCalledWith(['member-file'], false);
    });
  });

  describe('resolveKnowledgeItemIds', () => {
    it('resolves the same visible scope for members and owners', async () => {
      mockKnowledgeRepoQuery.mockResolvedValue([]);

      ({ caller } = createCallerWithCtx({
        workspaceId: 'workspace-active',
        workspaceRole: 'member',
      }));
      await caller.resolveKnowledgeItemIds({});

      expect(mockKnowledgeRepoQuery).toHaveBeenLastCalledWith({
        excludeKnowledgeBaseIds: [],
        includeContent: false,
        includeContentPreview: false,
        limit: 501,
        offset: 0,
        showFilesInKnowledgeBase: false,
      });

      ({ caller } = createCallerWithCtx({
        workspaceId: 'workspace-active',
        workspaceRole: 'owner',
      }));
      await caller.resolveKnowledgeItemIds({});

      expect(mockKnowledgeRepoQuery).toHaveBeenLastCalledWith({
        excludeKnowledgeBaseIds: [],
        includeContent: false,
        includeContentPreview: false,
        limit: 501,
        offset: 0,
        showFilesInKnowledgeBase: false,
      });
    });
  });

  describe('transferEntity', () => {
    it('should transfer document resources via documentModel', async () => {
      ctx.workspaceId = 'workspace-active';
      mockDocumentModelFindById.mockResolvedValue({ id: 'doc-1', userId: 'test-user' });
      mockDocumentModelCountFileUsageInSubtree.mockResolvedValue(4096);
      mockDocumentModelTransferTo.mockResolvedValue({ id: 'doc-1' });

      await caller.transferEntity({
        entityType: 'document',
        id: 'doc-1',
        targetWorkspaceId: null,
      });

      expect(mockDocumentModelFindById).toHaveBeenCalledWith('doc-1');
      expect(mockAssertCanPerformResourceAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'transfer',
          resourceId: 'doc-1',
          resourceType: 'document',
          userId: 'test-user',
          workspaceId: 'workspace-active',
        }),
      );
      expect(mockDocumentModelCountFileUsageInSubtree).toHaveBeenCalledWith('doc-1');
      expect(routerMocks.businessFileTransferStorageCheck).toHaveBeenCalledWith({
        additionalSize: 4096,
        targetUserId: 'test-user',
        targetWorkspaceId: null,
      });
      expect(mockDocumentModelTransferTo).toHaveBeenCalledWith(
        'doc-1',
        null,
        'test-user',
        undefined,
        {
          forbidForeignRows: true,
        },
      );
      expect(mockFileModelFindById).not.toHaveBeenCalled();
    });

    it('should check target storage before transferring a file resource', async () => {
      mockFileModelFindById.mockResolvedValue({ id: 'file-1', size: 2048 });
      mockFileModelTransferTo.mockResolvedValue({ fileId: 'file-1' });

      await caller.transferEntity({
        entityType: 'file',
        id: 'file-1',
        targetWorkspaceId: 'workspace-target',
      });

      expect(routerMocks.businessFileTransferStorageCheck).toHaveBeenCalledWith({
        additionalSize: 2048,
        targetUserId: 'test-user',
        targetWorkspaceId: 'workspace-target',
      });
      expect(mockFileModelTransferTo).toHaveBeenCalledWith(
        'file-1',
        'workspace-target',
        'test-user',
        undefined,
      );
    });

    it('should reject target workspace transfer when RBAC denies file upload', async () => {
      routerMocks.hasWorkspaceScopedPermission.mockResolvedValue(false);
      mockFileModelFindById.mockResolvedValue({ id: 'file-1', size: 2048 });

      await expect(
        caller.transferEntity({
          entityType: 'file',
          id: 'file-1',
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
      expect(mockFileModelTransferTo).not.toHaveBeenCalled();
    });
  });

  describe('copyEntityToWorkspace', () => {
    it('should check target storage before copying a file resource', async () => {
      mockFileModelFindById.mockResolvedValue({ id: 'file-1', size: 2048 });
      mockFileModelCopyToWorkspace.mockResolvedValue({ fileId: 'file-new' });

      await caller.copyEntityToWorkspace({
        entityType: 'file',
        id: 'file-1',
        targetWorkspaceId: null,
      });

      expect(routerMocks.businessFileTransferStorageCheck).toHaveBeenCalledWith({
        additionalSize: 2048,
        targetUserId: 'test-user',
        targetWorkspaceId: null,
      });
      expect(mockFileModelCopyToWorkspace).toHaveBeenCalledWith(
        'file-1',
        null,
        'test-user',
        undefined,
      );
    });

    it('should copy document resources via documentModel', async () => {
      mockDocumentModelCopyToWorkspace.mockResolvedValue({ id: 'doc-1' });
      mockDocumentModelFindById.mockResolvedValue({ id: 'doc-1', userId: 'test-user' });
      mockDocumentModelCountFileUsageInSubtree.mockResolvedValue(4096);

      await caller.copyEntityToWorkspace({
        entityType: 'document',
        id: 'doc-1',
        targetWorkspaceId: null,
      });

      expect(mockDocumentModelFindById).toHaveBeenCalledWith('doc-1');
      expect(mockDocumentModelCountFileUsageInSubtree).toHaveBeenCalledWith('doc-1');
      expect(routerMocks.businessFileTransferStorageCheck).toHaveBeenCalledWith({
        additionalSize: 4096,
        targetUserId: 'test-user',
        targetWorkspaceId: null,
      });
      expect(mockDocumentModelCopyToWorkspace).toHaveBeenCalledWith(
        'doc-1',
        null,
        'test-user',
        undefined,
      );
      expect(mockFileModelFindById).not.toHaveBeenCalled();
    });
  });

  describe('removeFileAsyncTask', () => {
    it('should do nothing when file not found', async () => {
      ctx.fileModel.findById.mockResolvedValue(null);

      await caller.removeFileAsyncTask({ id: 'test-id', type: 'chunk' });

      expect(ctx.asyncTaskModel.delete).not.toHaveBeenCalled();
    });

    it('should do nothing when task id is missing', async () => {
      ctx.fileModel.findById.mockResolvedValue(mockFile);

      await caller.removeFileAsyncTask({ id: 'test-id', type: 'embedding' });

      expect(ctx.asyncTaskModel.delete).not.toHaveBeenCalled();

      await caller.removeFileAsyncTask({ id: 'test-id', type: 'chunk' });

      expect(ctx.asyncTaskModel.delete).not.toHaveBeenCalled();
    });
  });
});
