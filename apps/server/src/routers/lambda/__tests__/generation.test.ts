import { TRPCError } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { GenerationModel } from '@/database/models/generation';
import { FileService } from '@/server/services/file';
import { AsyncTaskStatus } from '@/types/asyncTask';

import { generationRouter } from '../generation';

vi.mock('@/database/models/asyncTask');
vi.mock('@/database/models/generation');
vi.mock('@/server/services/file');

describe('generationRouter', () => {
  const mockCtx = {
    userId: 'test-user',
  };

  describe('getGenerationStatus', () => {
    it('should return generation status when task is successful', async () => {
      const mockGeneration = {
        id: 'gen-1',
        asset: { url: 'https://example.com/image.jpg' },
      };
      const mockAsyncTask = {
        id: 'task-1',
        status: AsyncTaskStatus.Success,
        error: null,
      };
      const mockCheckTimeoutTasks = vi.fn().mockResolvedValue(undefined);
      const mockFindById = vi.fn().mockResolvedValue(mockAsyncTask);
      const mockFindByIdAndTransform = vi.fn().mockResolvedValue(mockGeneration);

      vi.mocked(AsyncTaskModel).mockImplementation(
        () =>
          ({
            checkTimeoutTasks: mockCheckTimeoutTasks,
            findById: mockFindById,
          }) as any,
      );
      vi.mocked(GenerationModel).mockImplementation(
        () =>
          ({
            findByIdAndTransform: mockFindByIdAndTransform,
          }) as any,
      );

      const caller = generationRouter.createCaller(mockCtx);

      const result = await caller.getGenerationStatus({
        generationId: 'gen-1',
        asyncTaskId: 'task-1',
      });

      expect(result.status).toBe(AsyncTaskStatus.Success);
      expect(result.generation).toEqual(mockGeneration);
      expect(result.error).toBeNull();
      expect(mockCheckTimeoutTasks).toHaveBeenCalledWith(['task-1']);
      expect(mockFindById).toHaveBeenCalledWith('task-1');
      expect(mockFindByIdAndTransform).toHaveBeenCalledWith('gen-1');
    });

    it('should return error when task failed', async () => {
      const mockError = { code: 'GENERATION_ERROR', message: 'Generation failed' };
      const mockAsyncTask = {
        id: 'task-1',
        status: AsyncTaskStatus.Error,
        error: mockError,
      };
      const mockCheckTimeoutTasks = vi.fn().mockResolvedValue(undefined);
      const mockFindById = vi.fn().mockResolvedValue(mockAsyncTask);

      vi.mocked(AsyncTaskModel).mockImplementation(
        () =>
          ({
            checkTimeoutTasks: mockCheckTimeoutTasks,
            findById: mockFindById,
          }) as any,
      );

      const caller = generationRouter.createCaller(mockCtx);

      const result = await caller.getGenerationStatus({
        generationId: 'gen-1',
        asyncTaskId: 'task-1',
      });

      expect(result.status).toBe(AsyncTaskStatus.Error);
      expect(result.generation).toBeNull();
      expect(result.error).toEqual(mockError);
    });

    it('should return pending status when task is running', async () => {
      const mockAsyncTask = {
        id: 'task-1',
        status: AsyncTaskStatus.Pending,
        error: null,
      };
      const mockCheckTimeoutTasks = vi.fn().mockResolvedValue(undefined);
      const mockFindById = vi.fn().mockResolvedValue(mockAsyncTask);

      vi.mocked(AsyncTaskModel).mockImplementation(
        () =>
          ({
            checkTimeoutTasks: mockCheckTimeoutTasks,
            findById: mockFindById,
          }) as any,
      );

      const caller = generationRouter.createCaller(mockCtx);

      const result = await caller.getGenerationStatus({
        generationId: 'gen-1',
        asyncTaskId: 'task-1',
      });

      expect(result.status).toBe(AsyncTaskStatus.Pending);
      expect(result.generation).toBeNull();
      expect(result.error).toBeNull();
    });

    it('should throw error when async task not found', async () => {
      const mockCheckTimeoutTasks = vi.fn().mockResolvedValue(undefined);
      const mockFindById = vi.fn().mockResolvedValue(null);

      vi.mocked(AsyncTaskModel).mockImplementation(
        () =>
          ({
            checkTimeoutTasks: mockCheckTimeoutTasks,
            findById: mockFindById,
          }) as any,
      );

      const caller = generationRouter.createCaller(mockCtx);

      await expect(
        caller.getGenerationStatus({
          generationId: 'gen-1',
          asyncTaskId: 'task-1',
        }),
      ).rejects.toThrow(TRPCError);
    });

    it('should throw error when generation not found for successful task', async () => {
      const mockAsyncTask = {
        id: 'task-1',
        status: AsyncTaskStatus.Success,
        error: null,
      };
      const mockCheckTimeoutTasks = vi.fn().mockResolvedValue(undefined);
      const mockFindById = vi.fn().mockResolvedValue(mockAsyncTask);
      const mockFindByIdAndTransform = vi.fn().mockResolvedValue(null);

      vi.mocked(AsyncTaskModel).mockImplementation(
        () =>
          ({
            checkTimeoutTasks: mockCheckTimeoutTasks,
            findById: mockFindById,
          }) as any,
      );
      vi.mocked(GenerationModel).mockImplementation(
        () =>
          ({
            findByIdAndTransform: mockFindByIdAndTransform,
          }) as any,
      );

      const caller = generationRouter.createCaller(mockCtx);

      await expect(
        caller.getGenerationStatus({
          generationId: 'gen-1',
          asyncTaskId: 'task-1',
        }),
      ).rejects.toThrow(TRPCError);
    });
  });

  describe('deleteGeneration', () => {
    it('should delete generation with thumbnail', async () => {
      const mockDeletedGeneration = {
        id: 'gen-1',
        asset: { thumbnailUrl: 'thumb-key' },
      };
      const mockDelete = vi.fn().mockResolvedValue(mockDeletedGeneration);
      const mockDeleteFile = vi.fn().mockResolvedValue(true);

      vi.mocked(GenerationModel).mockImplementation(
        () =>
          ({
            delete: mockDelete,
          }) as any,
      );
      vi.mocked(FileService).mockImplementation(
        () =>
          ({
            deleteFile: mockDeleteFile,
          }) as any,
      );

      const caller = generationRouter.createCaller(mockCtx);

      const result = await caller.deleteGeneration({ generationId: 'gen-1' });

      expect(result).toEqual(mockDeletedGeneration);
      expect(mockDelete).toHaveBeenCalledWith('gen-1');
      expect(mockDeleteFile).toHaveBeenCalledWith('thumb-key');
    });

    it('should delete generation without thumbnail', async () => {
      const mockDeletedGeneration = {
        id: 'gen-1',
        asset: { url: 'main-url' },
      };
      const mockDelete = vi.fn().mockResolvedValue(mockDeletedGeneration);
      const mockDeleteFile = vi.fn().mockResolvedValue(true);

      vi.mocked(GenerationModel).mockImplementation(
        () =>
          ({
            delete: mockDelete,
          }) as any,
      );
      vi.mocked(FileService).mockImplementation(
        () =>
          ({
            deleteFile: mockDeleteFile,
          }) as any,
      );

      const caller = generationRouter.createCaller(mockCtx);

      const result = await caller.deleteGeneration({ generationId: 'gen-1' });

      expect(result).toEqual(mockDeletedGeneration);
      expect(mockDelete).toHaveBeenCalledWith('gen-1');
      expect(mockDeleteFile).not.toHaveBeenCalled();
    });

    it('should handle when generation not found', async () => {
      const mockDelete = vi.fn().mockResolvedValue(null);
      const mockDeleteFile = vi.fn().mockResolvedValue(true);

      vi.mocked(GenerationModel).mockImplementation(
        () =>
          ({
            delete: mockDelete,
          }) as any,
      );
      vi.mocked(FileService).mockImplementation(
        () =>
          ({
            deleteFile: mockDeleteFile,
          }) as any,
      );

      const caller = generationRouter.createCaller(mockCtx);

      const result = await caller.deleteGeneration({ generationId: 'gen-1' });

      expect(result).toBeUndefined();
      expect(mockDelete).toHaveBeenCalledWith('gen-1');
      expect(mockDeleteFile).not.toHaveBeenCalled();
    });
  });
});
