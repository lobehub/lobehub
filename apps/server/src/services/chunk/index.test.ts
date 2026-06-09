// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AsyncTaskError,
  AsyncTaskErrorType,
  AsyncTaskStatus,
  AsyncTaskType,
} from '@/types/asyncTask';

import { ChunkService } from './index';

const {
  mockAsyncTaskModelCreate,
  mockAsyncTaskModelUpdate,
  mockChunkContent,
  mockCreateAsyncCaller,
  mockEmbeddingChunks,
  mockFileModelFindById,
  mockFileModelUpdate,
  mockParseFileToChunks,
} = vi.hoisted(() => ({
  mockAsyncTaskModelCreate: vi.fn(),
  mockAsyncTaskModelUpdate: vi.fn(),
  mockChunkContent: vi.fn(),
  mockCreateAsyncCaller: vi.fn(),
  mockEmbeddingChunks: vi.fn(),
  mockFileModelFindById: vi.fn(),
  mockFileModelUpdate: vi.fn(),
  mockParseFileToChunks: vi.fn(),
}));

vi.mock('@/database/models/asyncTask', () => ({
  AsyncTaskModel: vi.fn(() => ({
    create: mockAsyncTaskModelCreate,
    update: mockAsyncTaskModelUpdate,
  })),
}));

vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(() => ({
    findById: mockFileModelFindById,
    update: mockFileModelUpdate,
  })),
}));

vi.mock('@/server/modules/ContentChunk', () => ({
  ContentChunk: vi.fn(() => ({
    chunkContent: mockChunkContent,
  })),
}));

vi.mock('@/server/routers/async', () => ({
  createAsyncCaller: mockCreateAsyncCaller,
}));

describe('ChunkService', () => {
  const userId = 'test-user-id';
  const mockDb = {} as any;
  let service: ChunkService;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockAsyncTaskModelCreate.mockResolvedValue('task-1');
    mockAsyncTaskModelUpdate.mockResolvedValue(undefined);
    mockChunkContent.mockResolvedValue({ chunks: [{ id: 'chunk-1', index: 0, text: 'chunk' }] });
    mockCreateAsyncCaller.mockResolvedValue({
      file: {
        embeddingChunks: mockEmbeddingChunks,
        parseFileToChunks: mockParseFileToChunks,
      },
    });
    mockEmbeddingChunks.mockResolvedValue(undefined);
    mockFileModelFindById.mockResolvedValue({ id: 'file-1' });
    mockFileModelUpdate.mockResolvedValue(undefined);
    mockParseFileToChunks.mockResolvedValue(undefined);

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    service = new ChunkService(mockDb, userId);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('chunkContent', () => {
    it('should delegate chunking to ContentChunk', async () => {
      const params = {
        content: new Uint8Array([1, 2, 3]),
        filename: 'test.md',
        fileType: 'text/markdown',
      };

      const result = await service.chunkContent(params);

      expect(mockChunkContent).toHaveBeenCalledWith(params);
      expect(result).toEqual({ chunks: [{ id: 'chunk-1', index: 0, text: 'chunk' }] });
    });
  });

  describe('asyncEmbeddingFileChunks', () => {
    it('should return undefined when file is not found', async () => {
      mockFileModelFindById.mockResolvedValue(undefined);

      await expect(service.asyncEmbeddingFileChunks('missing-file')).resolves.toBeUndefined();

      expect(mockAsyncTaskModelCreate).not.toHaveBeenCalled();
      expect(mockFileModelUpdate).not.toHaveBeenCalled();
      expect(mockCreateAsyncCaller).not.toHaveBeenCalled();
    });

    it('should create task, update file, and trigger embedding successfully', async () => {
      const taskId = await service.asyncEmbeddingFileChunks('file-1');

      expect(taskId).toBe('task-1');
      expect(mockAsyncTaskModelCreate).toHaveBeenCalledWith({
        status: AsyncTaskStatus.Pending,
        type: AsyncTaskType.Embedding,
      });
      expect(mockFileModelUpdate).toHaveBeenCalledWith('file-1', { embeddingTaskId: 'task-1' });
      expect(mockCreateAsyncCaller).toHaveBeenCalledWith({ userId });
      expect(mockEmbeddingChunks).toHaveBeenCalledWith({ fileId: 'file-1', taskId: 'task-1' });
      expect(mockAsyncTaskModelUpdate).not.toHaveBeenCalled();
    });

    it('should mark task as error when embedding trigger fails', async () => {
      const triggerError = new Error('embedding trigger failed');
      mockEmbeddingChunks.mockRejectedValue(triggerError);

      const taskId = await service.asyncEmbeddingFileChunks('file-1');

      expect(taskId).toBe('task-1');
      expect(consoleErrorSpy).toHaveBeenCalledWith('[embeddingFileChunks] error:', triggerError);
      expect(mockAsyncTaskModelUpdate).toHaveBeenCalledTimes(1);
      expect(mockAsyncTaskModelUpdate).toHaveBeenCalledWith('task-1', {
        error: new AsyncTaskError(
          AsyncTaskErrorType.TaskTriggerError,
          'trigger chunk embedding async task error. Please make sure the APP_URL is available from your server. You can check the proxy config or WAF blocking',
        ),
        status: AsyncTaskStatus.Error,
      });
    });
  });

  describe('asyncParseFileToChunks', () => {
    it('should return undefined when file is not found', async () => {
      mockFileModelFindById.mockResolvedValue(undefined);

      await expect(service.asyncParseFileToChunks('missing-file')).resolves.toBeUndefined();

      expect(mockAsyncTaskModelCreate).not.toHaveBeenCalled();
      expect(mockFileModelUpdate).not.toHaveBeenCalled();
      expect(mockCreateAsyncCaller).not.toHaveBeenCalled();
    });

    it('should skip creating a new task when skipExist is true and task already exists', async () => {
      mockFileModelFindById.mockResolvedValue({ chunkTaskId: 'existing-task', id: 'file-1' });

      await expect(service.asyncParseFileToChunks('file-1', true)).resolves.toBeUndefined();

      expect(mockAsyncTaskModelCreate).not.toHaveBeenCalled();
      expect(mockFileModelUpdate).not.toHaveBeenCalled();
      expect(mockCreateAsyncCaller).not.toHaveBeenCalled();
    });

    it('should create task, update file, and trigger chunk parsing successfully', async () => {
      const taskId = await service.asyncParseFileToChunks('file-1');

      expect(taskId).toBe('task-1');
      expect(mockAsyncTaskModelCreate).toHaveBeenCalledWith({
        status: AsyncTaskStatus.Processing,
        type: AsyncTaskType.Chunking,
      });
      expect(mockFileModelUpdate).toHaveBeenCalledWith('file-1', { chunkTaskId: 'task-1' });
      expect(mockCreateAsyncCaller).toHaveBeenCalledWith({ userId });
      expect(mockParseFileToChunks).toHaveBeenCalledWith({ fileId: 'file-1', taskId: 'task-1' });
      expect(mockAsyncTaskModelUpdate).not.toHaveBeenCalled();
    });

    it('should mark task as error when parse trigger fails asynchronously', async () => {
      const triggerError = new Error('parse trigger failed');
      mockParseFileToChunks.mockRejectedValue(triggerError);

      const taskId = await service.asyncParseFileToChunks('file-1');

      expect(taskId).toBe('task-1');

      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith('[ParseFileToChunks] error:', triggerError);
      expect(mockAsyncTaskModelUpdate).toHaveBeenCalledWith('task-1', {
        error: new AsyncTaskError(
          AsyncTaskErrorType.TaskTriggerError,
          'trigger chunk embedding async task error. Please make sure the APP_URL is available from your server. You can check the proxy config or WAF blocking',
        ),
        status: AsyncTaskStatus.Error,
      });
    });
  });
});
