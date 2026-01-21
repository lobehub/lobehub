// @vitest-environment node
import { LobeChatDatabase } from '@lobechat/database';
import { ClientSecretPayload } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { FileModel } from '@/database/models/file';
import { ContentChunk } from '@/server/modules/ContentChunk';
import { createAsyncCaller } from '@/server/routers/async';
import { AsyncTaskErrorType, AsyncTaskStatus, AsyncTaskType } from '@/types/asyncTask';

import { ChunkService } from './index';

// Mock dependencies
vi.mock('@/database/models/asyncTask');
vi.mock('@/database/models/file');
vi.mock('@/server/modules/ContentChunk');
vi.mock('@/server/routers/async');

describe('ChunkService', () => {
  let service: ChunkService;
  const mockDb = {} as LobeChatDatabase;
  const mockUserId = 'test-user-id';
  let mockFileModel: any;
  let mockAsyncTaskModel: any;
  let mockChunkClient: any;
  let mockAsyncCaller: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup FileModel mock
    mockFileModel = {
      findById: vi.fn(),
      update: vi.fn(),
    };
    vi.mocked(FileModel).mockImplementation(() => mockFileModel);

    // Setup AsyncTaskModel mock
    mockAsyncTaskModel = {
      create: vi.fn(),
      update: vi.fn(),
    };
    vi.mocked(AsyncTaskModel).mockImplementation(() => mockAsyncTaskModel);

    // Setup ContentChunk mock
    mockChunkClient = {
      chunkContent: vi.fn(),
    };
    vi.mocked(ContentChunk).mockImplementation(() => mockChunkClient);

    // Setup async caller mock
    mockAsyncCaller = {
      file: {
        embeddingChunks: vi.fn(),
        parseFileToChunks: vi.fn(),
      },
    };
    vi.mocked(createAsyncCaller).mockResolvedValue(mockAsyncCaller);

    service = new ChunkService(mockDb, mockUserId);
  });

  describe('constructor', () => {
    it('should initialize with correct dependencies', () => {
      expect(FileModel).toHaveBeenCalledWith(mockDb, mockUserId);
      expect(AsyncTaskModel).toHaveBeenCalledWith(mockDb, mockUserId);
      expect(ContentChunk).toHaveBeenCalled();
    });
  });

  describe('chunkContent', () => {
    it('should delegate to chunkClient.chunkContent', async () => {
      const mockParams = {
        content: new Uint8Array([1, 2, 3]),
        fileType: 'application/pdf',
        filename: 'test.pdf',
      };
      const mockResult = { chunks: [{ text: 'chunk1' }, { text: 'chunk2' }] };
      mockChunkClient.chunkContent.mockResolvedValue(mockResult);

      const result = await service.chunkContent(mockParams);

      expect(mockChunkClient.chunkContent).toHaveBeenCalledWith(mockParams);
      expect(result).toEqual(mockResult);
    });
  });

  describe('asyncEmbeddingFileChunks', () => {
    const fileId = 'test-file-id';
    const payload: ClientSecretPayload = {
      apiKey: 'test-key',
      baseURL: 'https://test-endpoint.com',
    };

    it('should return undefined if file is not found', async () => {
      mockFileModel.findById.mockResolvedValue(null);

      const result = await service.asyncEmbeddingFileChunks(fileId, payload);

      expect(mockFileModel.findById).toHaveBeenCalledWith(fileId);
      expect(result).toBeUndefined();
      expect(mockAsyncTaskModel.create).not.toHaveBeenCalled();
    });

    it('should create embedding task and trigger async embedding successfully', async () => {
      const mockFile = { id: fileId, name: 'test.pdf' };
      const mockTaskId = 'task-123';

      mockFileModel.findById.mockResolvedValue(mockFile);
      mockAsyncTaskModel.create.mockResolvedValue(mockTaskId);
      mockAsyncCaller.file.embeddingChunks.mockResolvedValue(undefined);

      const result = await service.asyncEmbeddingFileChunks(fileId, payload);

      // Verify task creation
      expect(mockAsyncTaskModel.create).toHaveBeenCalledWith({
        status: AsyncTaskStatus.Pending,
        type: AsyncTaskType.Embedding,
      });

      // Verify file update with task ID
      expect(mockFileModel.update).toHaveBeenCalledWith(fileId, {
        embeddingTaskId: mockTaskId,
      });

      // Verify async caller creation
      expect(createAsyncCaller).toHaveBeenCalledWith({
        jwtPayload: payload,
        userId: mockUserId,
      });

      // Verify embedding task trigger
      expect(mockAsyncCaller.file.embeddingChunks).toHaveBeenCalledWith({
        fileId,
        taskId: mockTaskId,
      });

      expect(result).toBe(mockTaskId);
    });

    it('should handle embedding task trigger error and update task status', async () => {
      const mockFile = { id: fileId, name: 'test.pdf' };
      const mockTaskId = 'task-123';
      const mockError = new Error('Network error');

      mockFileModel.findById.mockResolvedValue(mockFile);
      mockAsyncTaskModel.create.mockResolvedValue(mockTaskId);
      mockAsyncCaller.file.embeddingChunks.mockRejectedValue(mockError);

      // Spy on console.error
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await service.asyncEmbeddingFileChunks(fileId, payload);

      // Verify error was logged
      expect(consoleErrorSpy).toHaveBeenCalledWith('[embeddingFileChunks] error:', mockError);

      // Verify task status was updated to Error
      expect(mockAsyncTaskModel.update).toHaveBeenCalledWith(mockTaskId, {
        error: expect.objectContaining({
          name: AsyncTaskErrorType.TaskTriggerError,
          body: expect.objectContaining({
            detail:
              'trigger chunk embedding async task error. Please make sure the APP_URL is available from your server. You can check the proxy config or WAF blocking',
          }),
        }),
        status: AsyncTaskStatus.Error,
      });

      expect(result).toBe(mockTaskId);

      consoleErrorSpy.mockRestore();
    });

    it('should handle createAsyncCaller error', async () => {
      const mockFile = { id: fileId, name: 'test.pdf' };
      const mockTaskId = 'task-123';

      mockFileModel.findById.mockResolvedValue(mockFile);
      mockAsyncTaskModel.create.mockResolvedValue(mockTaskId);
      vi.mocked(createAsyncCaller).mockRejectedValue(new Error('Auth error'));

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(service.asyncEmbeddingFileChunks(fileId, payload)).rejects.toThrow('Auth error');

      consoleErrorSpy.mockRestore();
    });
  });

  describe('asyncParseFileToChunks', () => {
    const fileId = 'test-file-id';
    const payload: ClientSecretPayload = {
      apiKey: 'test-key',
      baseURL: 'https://test-endpoint.com',
    };

    it('should return undefined if file is not found', async () => {
      mockFileModel.findById.mockResolvedValue(null);

      const result = await service.asyncParseFileToChunks(fileId, payload);

      expect(mockFileModel.findById).toHaveBeenCalledWith(fileId);
      expect(result).toBeUndefined();
      expect(mockAsyncTaskModel.create).not.toHaveBeenCalled();
    });

    it('should skip if file already has chunk task and skipExist is true', async () => {
      const mockFile = { id: fileId, name: 'test.pdf', chunkTaskId: 'existing-task' };

      mockFileModel.findById.mockResolvedValue(mockFile);

      const result = await service.asyncParseFileToChunks(fileId, payload, true);

      expect(mockFileModel.findById).toHaveBeenCalledWith(fileId);
      expect(result).toBeUndefined();
      expect(mockAsyncTaskModel.create).not.toHaveBeenCalled();
    });

    it('should not skip if file has chunk task but skipExist is false', async () => {
      const mockFile = { id: fileId, name: 'test.pdf', chunkTaskId: 'existing-task' };
      const mockTaskId = 'new-task-123';

      mockFileModel.findById.mockResolvedValue(mockFile);
      mockAsyncTaskModel.create.mockResolvedValue(mockTaskId);
      mockAsyncCaller.file.parseFileToChunks.mockResolvedValue(undefined);

      const result = await service.asyncParseFileToChunks(fileId, payload, false);

      expect(mockAsyncTaskModel.create).toHaveBeenCalled();
      expect(result).toBe(mockTaskId);
    });

    it('should not skip if file has no chunk task and skipExist is undefined', async () => {
      const mockFile = { id: fileId, name: 'test.pdf', chunkTaskId: null };
      const mockTaskId = 'task-123';

      mockFileModel.findById.mockResolvedValue(mockFile);
      mockAsyncTaskModel.create.mockResolvedValue(mockTaskId);
      mockAsyncCaller.file.parseFileToChunks.mockResolvedValue(undefined);

      const result = await service.asyncParseFileToChunks(fileId, payload);

      expect(mockAsyncTaskModel.create).toHaveBeenCalled();
      expect(result).toBe(mockTaskId);
    });

    it('should create chunk task and trigger async parsing successfully', async () => {
      const mockFile = { id: fileId, name: 'test.pdf' };
      const mockTaskId = 'task-123';

      mockFileModel.findById.mockResolvedValue(mockFile);
      mockAsyncTaskModel.create.mockResolvedValue(mockTaskId);
      mockAsyncCaller.file.parseFileToChunks.mockResolvedValue(undefined);

      const result = await service.asyncParseFileToChunks(fileId, payload);

      // Verify task creation with Processing status (different from embedding)
      expect(mockAsyncTaskModel.create).toHaveBeenCalledWith({
        status: AsyncTaskStatus.Processing,
        type: AsyncTaskType.Chunking,
      });

      // Verify file update with task ID
      expect(mockFileModel.update).toHaveBeenCalledWith(fileId, {
        chunkTaskId: mockTaskId,
      });

      // Verify async caller creation
      expect(createAsyncCaller).toHaveBeenCalledWith({
        jwtPayload: payload,
        userId: mockUserId,
      });

      // Verify parse file task trigger
      expect(mockAsyncCaller.file.parseFileToChunks).toHaveBeenCalledWith({
        fileId,
        taskId: mockTaskId,
      });

      expect(result).toBe(mockTaskId);
    });

    it('should handle parse task trigger error asynchronously', async () => {
      const mockFile = { id: fileId, name: 'test.pdf' };
      const mockTaskId = 'task-123';
      const mockError = new Error('Parse error');

      mockFileModel.findById.mockResolvedValue(mockFile);
      mockAsyncTaskModel.create.mockResolvedValue(mockTaskId);

      // Mock parseFileToChunks to reject
      const parsePromise = Promise.reject(mockError);
      mockAsyncCaller.file.parseFileToChunks.mockReturnValue(parsePromise);

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await service.asyncParseFileToChunks(fileId, payload);

      // Result should still be the taskId
      expect(result).toBe(mockTaskId);

      // Wait for the async error handler to complete
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify error was logged
      expect(consoleErrorSpy).toHaveBeenCalledWith('[ParseFileToChunks] error:', mockError);

      // Verify task status was updated to Error
      expect(mockAsyncTaskModel.update).toHaveBeenCalledWith(mockTaskId, {
        error: expect.objectContaining({
          name: AsyncTaskErrorType.TaskTriggerError,
          body: expect.objectContaining({
            detail:
              'trigger chunk embedding async task error. Please make sure the APP_URL is available from your server. You can check the proxy config or WAF blocking',
          }),
        }),
        status: AsyncTaskStatus.Error,
      });

      consoleErrorSpy.mockRestore();
    });

    it('should handle task creation failure', async () => {
      const mockFile = { id: fileId, name: 'test.pdf' };

      mockFileModel.findById.mockResolvedValue(mockFile);
      mockAsyncTaskModel.create.mockRejectedValue(new Error('DB error'));

      await expect(service.asyncParseFileToChunks(fileId, payload)).rejects.toThrow('DB error');

      // Verify file was not updated if task creation fails
      expect(mockFileModel.update).not.toHaveBeenCalled();
      expect(mockAsyncCaller.file.parseFileToChunks).not.toHaveBeenCalled();
    });

    it('should handle file update failure after task creation', async () => {
      const mockFile = { id: fileId, name: 'test.pdf' };
      const mockTaskId = 'task-123';

      mockFileModel.findById.mockResolvedValue(mockFile);
      mockAsyncTaskModel.create.mockResolvedValue(mockTaskId);
      mockFileModel.update.mockRejectedValue(new Error('Update failed'));

      await expect(service.asyncParseFileToChunks(fileId, payload)).rejects.toThrow(
        'Update failed',
      );

      // Verify async caller was not invoked if file update fails
      expect(createAsyncCaller).not.toHaveBeenCalled();
      expect(mockAsyncCaller.file.parseFileToChunks).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    const fileId = 'test-file-id';
    const payload: ClientSecretPayload = {
      apiKey: 'test-key',
      baseURL: 'https://test-endpoint.com',
    };

    it('should handle empty file ID in asyncEmbeddingFileChunks', async () => {
      mockFileModel.findById.mockResolvedValue(null);

      const result = await service.asyncEmbeddingFileChunks('', payload);

      expect(mockFileModel.findById).toHaveBeenCalledWith('');
      expect(result).toBeUndefined();
    });

    it('should handle empty file ID in asyncParseFileToChunks', async () => {
      mockFileModel.findById.mockResolvedValue(null);

      const result = await service.asyncParseFileToChunks('', payload);

      expect(mockFileModel.findById).toHaveBeenCalledWith('');
      expect(result).toBeUndefined();
    });

    it('should handle skipExist edge cases', async () => {
      const mockFile = { id: fileId, name: 'test.pdf', chunkTaskId: null };
      const mockTaskId = 'task-123';

      mockFileModel.findById.mockResolvedValue(mockFile);
      mockAsyncTaskModel.create.mockResolvedValue(mockTaskId);
      mockAsyncCaller.file.parseFileToChunks.mockResolvedValue(undefined);

      // Test with null chunkTaskId and skipExist true
      const result = await service.asyncParseFileToChunks(fileId, payload, true);

      // Should proceed because chunkTaskId is null
      expect(mockAsyncTaskModel.create).toHaveBeenCalled();
      expect(result).toBe(mockTaskId);
    });
  });

  describe('integration scenarios', () => {
    const fileId = 'test-file-id';
    const payload: ClientSecretPayload = {
      apiKey: 'test-key',
      baseURL: 'https://test-endpoint.com',
    };

    it('should handle sequential chunking and embedding workflow', async () => {
      const mockFile = { id: fileId, name: 'test.pdf' };
      const chunkTaskId = 'chunk-task-123';
      const embeddingTaskId = 'embedding-task-456';

      // First: Parse file to chunks
      mockFileModel.findById.mockResolvedValue(mockFile);
      mockAsyncTaskModel.create.mockResolvedValueOnce(chunkTaskId);
      mockAsyncCaller.file.parseFileToChunks.mockResolvedValue(undefined);

      const parseResult = await service.asyncParseFileToChunks(fileId, payload);
      expect(parseResult).toBe(chunkTaskId);

      // Second: Embed chunks
      mockFileModel.findById.mockResolvedValue({
        ...mockFile,
        chunkTaskId,
      });
      mockAsyncTaskModel.create.mockResolvedValueOnce(embeddingTaskId);
      mockAsyncCaller.file.embeddingChunks.mockResolvedValue(undefined);

      const embeddingResult = await service.asyncEmbeddingFileChunks(fileId, payload);
      expect(embeddingResult).toBe(embeddingTaskId);

      // Verify both tasks were created
      expect(mockAsyncTaskModel.create).toHaveBeenCalledTimes(2);
      expect(mockFileModel.update).toHaveBeenCalledTimes(2);
    });
  });
});
