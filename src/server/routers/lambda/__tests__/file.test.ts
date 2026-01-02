import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fileRouter } from '@/server/routers/lambda/file';
import { AsyncTaskStatus } from '@/types/asyncTask';

// Patch: Use actual router context middleware to inject the correct models/services
function createCallerWithCtx(partialCtx: any = {}) {
  // All mocks are spies
  const fileModel = {
    checkHash: vi.fn().mockResolvedValue({ isExist: true }),
    create: vi.fn().mockResolvedValue({ id: 'test-id' }),
    findById: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
    deleteMany: vi.fn().mockResolvedValue([]),
    clear: vi.fn().mockResolvedValue({} as any),
  };

  const fileService = {
    getFullFileUrl: vi.fn().mockResolvedValue('full-url'),
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

  const ctx = {
    serverDB: {} as any,
    userId: 'test-user',
    asyncTaskModel,
    chunkModel,
    documentModel,
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
const mockFileModelDeleteMany = vi.fn();
const mockFileModelFindById = vi.fn();
const mockFileModelQuery = vi.fn();
const mockFileModelClear = vi.fn();

vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(() => ({
    checkHash: mockFileModelCheckHash,
    create: mockFileModelCreate,
    delete: mockFileModelDelete,
    deleteMany: mockFileModelDeleteMany,
    findById: mockFileModelFindById,
    query: mockFileModelQuery,
    clear: mockFileModelClear,
  })),
}));

const mockFileServiceGetFullFileUrl = vi.fn();

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(() => ({
    deleteFile: vi.fn(),
    deleteFiles: vi.fn(),
    getFullFileUrl: mockFileServiceGetFullFileUrl,
  })),
}));

const mockKnowledgeRepoQuery = vi.fn().mockResolvedValue([]);

vi.mock('@/database/repositories/knowledge', () => ({
  KnowledgeRepo: vi.fn(() => ({
    query: mockKnowledgeRepoQuery,
  })),
}));

vi.mock('@/database/models/document', () => ({
  DocumentModel: vi.fn(() => ({})),
}));

describe('fileRouter', () => {
  let ctx: any;
  let caller: any;
  let mockFile: any;

  beforeEach(() => {
    vi.clearAllMocks();

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

    // Use actual context with default mocks
    ({ ctx, caller } = createCallerWithCtx());
  });

  describe('checkFileHash', () => {
    it('should handle when fileModel.checkHash returns undefined', async () => {
      ctx.fileModel.checkHash.mockResolvedValue(undefined);
      await expect(caller.checkFileHash({ hash: 'test-hash' })).resolves.toBeUndefined();
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
    it('should return knowledge items with files and documents', async () => {
      const knowledgeItems = [
        {
          ...mockFile,
          chunkTaskId: 'chunk-1',
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
    });
  });

  describe('removeFile', () => {
    it('should do nothing when file not found', async () => {
      ctx.fileModel.delete.mockResolvedValue(null);

      await caller.removeFile({ id: 'invalid-id' });

      expect(ctx.fileService.deleteFile).not.toHaveBeenCalled();
    });
  });

  describe('removeFiles', () => {
    it('should do nothing when no files found', async () => {
      ctx.fileModel.deleteMany.mockResolvedValue([]);

      await caller.removeFiles({ ids: ['invalid-1', 'invalid-2'] });

      expect(ctx.fileService.deleteFiles).not.toHaveBeenCalled();
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
