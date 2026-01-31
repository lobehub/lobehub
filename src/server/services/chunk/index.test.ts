// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { FileModel } from '@/database/models/file';
import { ContentChunk } from '@/server/modules/ContentChunk';
import { createAsyncCaller } from '@/server/routers/async';
import {
  AsyncTaskError,
  AsyncTaskErrorType,
  AsyncTaskStatus,
  AsyncTaskType,
} from '@/types/asyncTask';

import { ChunkService } from './index';

vi.mock('@/envs/llm', () => ({
  getLLMConfig: vi.fn(() => ({
    OPENAI_API_KEY: 'test-key',
  })),
}));

vi.mock('@/database/models/asyncTask');
vi.mock('@/database/models/file');
vi.mock('@/server/modules/ContentChunk');
vi.mock('@/server/routers/async');

describe('ChunkService', () => {
  let chunkService: ChunkService;
  let mockDB: LobeChatDatabase;
  let mockFileModel: FileModel;
  let mockAsyncTaskModel: AsyncTaskModel;
  let mockChunkClient: ContentChunk;
  let consoleErrorSpy: any;
  const userId = 'test-user-id';

  beforeEach(() => {
    mockDB = {} as LobeChatDatabase;
    mockFileModel = {
      findById: vi.fn(),
      update: vi.fn(),
    } as any;

    mockAsyncTaskModel = {
      create: vi.fn(),
      update: vi.fn(),
    } as any;

    mockChunkClient = {
      chunkContent: vi.fn(),
    } as any;

    // Mock constructors
    vi.mocked(FileModel).mockImplementation(() => mockFileModel);
    vi.mocked(AsyncTaskModel).mockImplementation(() => mockAsyncTaskModel);
    vi.mocked(ContentChunk).mockImplementation(() => mockChunkClient);

    // Mock console.error to test error logging
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    chunkService = new ChunkService(mockDB, userId);
  });

  afterEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy?.mockRestore();
  });

  describe('chunkContent', () => {
    it('should delegate to chunk client', async () => {
      const params = {
        content: new Uint8Array([1, 2, 3]),
        fileType: 'application/pdf',
        filename: 'test.pdf',
      };
      const expectedResult = { chunks: [{ id: 'chunk-1', text: 'test content', index: 0 }] };

      vi.mocked(mockChunkClient.chunkContent).mockResolvedValue(expectedResult as any);

      const result = await chunkService.chunkContent(params);

      expect(mockChunkClient.chunkContent).toHaveBeenCalledWith(params);
      expect(result).toEqual(expectedResult);
    });

    it('should handle chunk client errors', async () => {
      const params = {
        content: new Uint8Array([1, 2, 3]),
        fileType: 'application/pdf',
        filename: 'test.pdf',
      };
      const error = new Error('Chunking failed');

      vi.mocked(mockChunkClient.chunkContent).mockRejectedValue(error);

      await expect(chunkService.chunkContent(params)).rejects.toThrow('Chunking failed');
    });
  });

  describe('asyncEmbeddingFileChunks', () => {
    const fileId = 'test-file-id';
    const asyncTaskId = 'test-task-id';

    it('should return undefined if file not found', async () => {
      mockFileModel.findById = vi.fn().mockResolvedValue(null);

      const result = await chunkService.asyncEmbeddingFileChunks(fileId);

      expect(result).toBeUndefined();
      expect(mockFileModel.findById).toHaveBeenCalledWith(fileId);
      expect(mockAsyncTaskModel.create).not.toHaveBeenCalled();
    });

    it('should create async task and trigger embedding successfully', async () => {
      const mockFile = { id: fileId, name: 'test.pdf' };
      const mockAsyncCaller = {
        file: {
          embeddingChunks: vi.fn().mockResolvedValue(undefined),
        },
      };

      mockFileModel.findById = vi.fn().mockResolvedValue(mockFile);
      mockAsyncTaskModel.create = vi.fn().mockResolvedValue(asyncTaskId);
      vi.mocked(createAsyncCaller).mockResolvedValue(mockAsyncCaller as any);

      const result = await chunkService.asyncEmbeddingFileChunks(fileId);

      expect(mockFileModel.findById).toHaveBeenCalledWith(fileId);
      expect(mockAsyncTaskModel.create).toHaveBeenCalledWith({
        status: AsyncTaskStatus.Pending,
        type: AsyncTaskType.Embedding,
      });
      expect(mockFileModel.update).toHaveBeenCalledWith(fileId, {
        embeddingTaskId: asyncTaskId,
      });
      expect(createAsyncCaller).toHaveBeenCalledWith({ userId });
      expect(mockAsyncCaller.file.embeddingChunks).toHaveBeenCalledWith({
        fileId,
        taskId: asyncTaskId,
      });
      expect(result).toBe(asyncTaskId);
    });

    it('should handle async caller creation errors and update task status', async () => {
      const mockFile = { id: fileId, name: 'test.pdf' };
      const error = new Error('Async caller failed');
      const mockAsyncCaller = {
        file: {
          embeddingChunks: vi.fn().mockRejectedValue(error),
        },
      };

      mockFileModel.findById = vi.fn().mockResolvedValue(mockFile);
      mockAsyncTaskModel.create = vi.fn().mockResolvedValue(asyncTaskId);
      vi.mocked(createAsyncCaller).mockResolvedValue(mockAsyncCaller as any);

      const result = await chunkService.asyncEmbeddingFileChunks(fileId);

      expect(consoleErrorSpy).toHaveBeenCalledWith('[embeddingFileChunks] error:', error);
      expect(mockAsyncTaskModel.update).toHaveBeenCalledWith(asyncTaskId, {
        error: new AsyncTaskError(
          AsyncTaskErrorType.TaskTriggerError,
          'trigger chunk embedding async task error. Please make sure the APP_URL is available from your server. You can check the proxy config or WAF blocking',
        ),
        status: AsyncTaskStatus.Error,
      });
      expect(result).toBe(asyncTaskId);
    });

    it('should handle embedding trigger errors and update task status', async () => {
      const mockFile = { id: fileId, name: 'test.pdf' };
      const error = new Error('Network error');
      const mockAsyncCaller = {
        file: {
          embeddingChunks: vi.fn().mockRejectedValue(error),
        },
      };

      mockFileModel.findById = vi.fn().mockResolvedValue(mockFile);
      mockAsyncTaskModel.create = vi.fn().mockResolvedValue(asyncTaskId);
      vi.mocked(createAsyncCaller).mockResolvedValue(mockAsyncCaller as any);

      await chunkService.asyncEmbeddingFileChunks(fileId);

      expect(mockAsyncTaskModel.update).toHaveBeenCalledWith(
        asyncTaskId,
        expect.objectContaining({
          status: AsyncTaskStatus.Error,
          error: expect.any(AsyncTaskError),
        }),
      );
    });
  });

  describe('asyncParseFileToChunks', () => {
    const fileId = 'test-file-id';
    const asyncTaskId = 'test-task-id';

    it('should return undefined if file not found', async () => {
      mockFileModel.findById = vi.fn().mockResolvedValue(null);

      const result = await chunkService.asyncParseFileToChunks(fileId);

      expect(result).toBeUndefined();
      expect(mockFileModel.findById).toHaveBeenCalledWith(fileId);
      expect(mockAsyncTaskModel.create).not.toHaveBeenCalled();
    });

    it('should skip if chunk task already exists when skipExist is true', async () => {
      const mockFile = { id: fileId, name: 'test.pdf', chunkTaskId: 'existing-task-id' };
      mockFileModel.findById = vi.fn().mockResolvedValue(mockFile);

      const result = await chunkService.asyncParseFileToChunks(fileId, true);

      expect(result).toBeUndefined();
      expect(mockFileModel.findById).toHaveBeenCalledWith(fileId);
      expect(mockAsyncTaskModel.create).not.toHaveBeenCalled();
    });

    it('should not skip if chunk task exists when skipExist is false', async () => {
      const mockFile = { id: fileId, name: 'test.pdf', chunkTaskId: 'existing-task-id' };
      const mockAsyncCaller = {
        file: {
          parseFileToChunks: vi.fn().mockResolvedValue(undefined),
        },
      };

      mockFileModel.findById = vi.fn().mockResolvedValue(mockFile);
      mockAsyncTaskModel.create = vi.fn().mockResolvedValue(asyncTaskId);
      vi.mocked(createAsyncCaller).mockResolvedValue(mockAsyncCaller as any);

      const result = await chunkService.asyncParseFileToChunks(fileId, false);

      expect(mockAsyncTaskModel.create).toHaveBeenCalled();
      expect(result).toBe(asyncTaskId);
    });

    it('should create async task and trigger parse file successfully', async () => {
      const mockFile = { id: fileId, name: 'test.pdf' };
      const mockAsyncCaller = {
        file: {
          parseFileToChunks: vi.fn().mockResolvedValue(undefined),
        },
      };

      mockFileModel.findById = vi.fn().mockResolvedValue(mockFile);
      mockAsyncTaskModel.create = vi.fn().mockResolvedValue(asyncTaskId);
      vi.mocked(createAsyncCaller).mockResolvedValue(mockAsyncCaller as any);

      const result = await chunkService.asyncParseFileToChunks(fileId);

      expect(mockFileModel.findById).toHaveBeenCalledWith(fileId);
      expect(mockAsyncTaskModel.create).toHaveBeenCalledWith({
        status: AsyncTaskStatus.Processing,
        type: AsyncTaskType.Chunking,
      });
      expect(mockFileModel.update).toHaveBeenCalledWith(fileId, {
        chunkTaskId: asyncTaskId,
      });
      expect(createAsyncCaller).toHaveBeenCalledWith({ userId });
      expect(mockAsyncCaller.file.parseFileToChunks).toHaveBeenCalledWith({
        fileId,
        taskId: asyncTaskId,
      });
      expect(result).toBe(asyncTaskId);
    });

    it('should handle parse file trigger errors and update task status', async () => {
      const mockFile = { id: fileId, name: 'test.pdf' };
      const error = new Error('Parse failed');
      const mockAsyncCaller = {
        file: {
          parseFileToChunks: vi.fn().mockRejectedValue(error),
        },
      };

      mockFileModel.findById = vi.fn().mockResolvedValue(mockFile);
      mockAsyncTaskModel.create = vi.fn().mockResolvedValue(asyncTaskId);
      vi.mocked(createAsyncCaller).mockResolvedValue(mockAsyncCaller as any);

      // parseFileToChunks is called with .catch(), so we need to wait a bit for the error handler
      await chunkService.asyncParseFileToChunks(fileId);

      // Wait for the catch block to execute
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(consoleErrorSpy).toHaveBeenCalledWith('[ParseFileToChunks] error:', error);
      expect(mockAsyncTaskModel.update).toHaveBeenCalledWith(asyncTaskId, {
        error: new AsyncTaskError(
          AsyncTaskErrorType.TaskTriggerError,
          'trigger chunk embedding async task error. Please make sure the APP_URL is available from your server. You can check the proxy config or WAF blocking',
        ),
        status: AsyncTaskStatus.Error,
      });
    });

    it('should handle async task creation with Processing status', async () => {
      const mockFile = { id: fileId, name: 'test.pdf' };
      const mockAsyncCaller = {
        file: {
          parseFileToChunks: vi.fn().mockResolvedValue(undefined),
        },
      };

      mockFileModel.findById = vi.fn().mockResolvedValue(mockFile);
      mockAsyncTaskModel.create = vi.fn().mockResolvedValue(asyncTaskId);
      vi.mocked(createAsyncCaller).mockResolvedValue(mockAsyncCaller as any);

      await chunkService.asyncParseFileToChunks(fileId);

      expect(mockAsyncTaskModel.create).toHaveBeenCalledWith({
        status: AsyncTaskStatus.Processing,
        type: AsyncTaskType.Chunking,
      });
    });

    it('should not skip task creation when skipExist is undefined', async () => {
      const mockFile = { id: fileId, name: 'test.pdf', chunkTaskId: 'existing-task-id' };
      const mockAsyncCaller = {
        file: {
          parseFileToChunks: vi.fn().mockResolvedValue(undefined),
        },
      };

      mockFileModel.findById = vi.fn().mockResolvedValue(mockFile);
      mockAsyncTaskModel.create = vi.fn().mockResolvedValue(asyncTaskId);
      vi.mocked(createAsyncCaller).mockResolvedValue(mockAsyncCaller as any);

      const result = await chunkService.asyncParseFileToChunks(fileId);

      expect(mockAsyncTaskModel.create).toHaveBeenCalled();
      expect(result).toBe(asyncTaskId);
    });
  });
});
