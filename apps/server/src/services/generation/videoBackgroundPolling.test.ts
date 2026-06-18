import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { GenerationModel } from '@/database/models/generation';
import type { LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { VideoGenerationService } from '@/server/services/generation/video';
import { processBackgroundVideoPolling } from '@/server/services/generation/videoBackgroundPolling';
import { AsyncTaskError, AsyncTaskStatus } from '@/types/asyncTask';
import { FileSource } from '@/types/files';

vi.mock('@/database/models/asyncTask');
vi.mock('@/database/models/generation');
vi.mock('@/server/services/generation/video');
vi.mock('@/utils/sanitizeFileName', () => ({
  sanitizeFileName: vi.fn((...args) => args.join('-')),
}));

vi.mock('debug', () => ({
  default: () => vi.fn(),
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
}));

describe('videoBackgroundPolling', () => {
  const mockAsyncTaskModel = {
    update: vi.fn(),
  };

  const mockGenerationModel = {
    createAssetAndFile: vi.fn(),
  };

  const mockVideoService = {
    processVideoForGeneration: vi.fn(),
  };

  const mockModelRuntime = {
    handlePollVideoStatus: vi.fn(),
  };

  const mockDb = {
    query: {
      generationBatches: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'batch-123',
          prompt: 'test-prompt',
        }),
      },
    },
  } as any as LobeChatDatabase;

  const mockParams = {
    asyncTaskCreatedAt: new Date('2024-01-01T00:00:00Z'),
    asyncTaskId: 'task-123',
    generationBatchId: 'batch-123',
    generationId: 'gen-456',
    generationTopicId: 'topic-789',
    inferenceId: 'inference-abc',
    model: 'test-model',
    prechargeResult: { credits: 10 },
    provider: 'test-provider',
    userId: 'user-xyz',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    vi.mocked(AsyncTaskModel).mockImplementation(() => mockAsyncTaskModel as any);
    vi.mocked(GenerationModel).mockImplementation(() => mockGenerationModel as any);
    vi.mocked(VideoGenerationService).mockImplementation(() => mockVideoService as any);
    vi.mocked(initModelRuntimeFromDB).mockResolvedValue(mockModelRuntime as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('processBackgroundVideoPolling - success path', () => {
    it('should complete video generation successfully', async () => {
      mockModelRuntime.handlePollVideoStatus.mockResolvedValue({
        status: 'success',
        videoUrl: 'https://example.com/video.mp4',
        headers: { 'Content-Type': 'video/mp4' },
      });

      mockVideoService.processVideoForGeneration.mockResolvedValue({
        coverKey: 'cover-key-123',
        duration: 10,
        fileHash: 'hash-abc',
        fileSize: 1024,
        height: 1080,
        mimeType: 'video/mp4',
        thumbnailKey: 'thumb-key-456',
        videoKey: 'video-key-789',
        width: 1920,
      });

      await processBackgroundVideoPolling(mockDb, mockParams);

      expect(mockModelRuntime.handlePollVideoStatus).toHaveBeenCalledWith('inference-abc');

      expect(mockVideoService.processVideoForGeneration).toHaveBeenCalledWith(
        'https://example.com/video.mp4',
        { headers: { 'Content-Type': 'video/mp4' } },
      );

      expect(mockGenerationModel.createAssetAndFile).toHaveBeenCalledWith(
        'gen-456',
        expect.objectContaining({
          coverUrl: 'cover-key-123',
          duration: 10,
          height: 1080,
          originalUrl: 'https://example.com/video.mp4',
          thumbnailUrl: 'thumb-key-456',
          type: 'video',
          url: 'video-key-789',
          width: 1920,
        }),
        expect.objectContaining({
          fileHash: 'hash-abc',
          fileType: 'video/mp4',
          name: 'test-prompt-gen-456.mp4',
          size: 1024,
          url: 'video-key-789',
        }),
        FileSource.VideoGeneration,
      );

      expect(mockAsyncTaskModel.update).toHaveBeenCalledWith('task-123', {
        duration: expect.any(Number),
        status: AsyncTaskStatus.Success,
      });
    });
  });

  describe('processBackgroundVideoPolling - polling behavior', () => {
    it('should retry polling multiple times until success', async () => {
      mockModelRuntime.handlePollVideoStatus
        .mockResolvedValueOnce({ status: 'processing' })
        .mockResolvedValueOnce({ status: 'processing' })
        .mockResolvedValueOnce({
          status: 'success',
          videoUrl: 'https://example.com/video.mp4',
        });

      mockVideoService.processVideoForGeneration.mockResolvedValue({
        coverKey: 'cover-key',
        duration: 10,
        fileHash: 'hash',
        fileSize: 1024,
        height: 1080,
        mimeType: 'video/mp4',
        thumbnailKey: 'thumb-key',
        videoKey: 'video-key',
        width: 1920,
      });

      const pollPromise = processBackgroundVideoPolling(mockDb, mockParams);

      await vi.advanceTimersByTimeAsync(10000);

      await pollPromise;

      expect(mockModelRuntime.handlePollVideoStatus).toHaveBeenCalledTimes(3);
    });
  });

  describe('processBackgroundVideoPolling - error handling', () => {
    it('should handle polling failure with error message', async () => {
      mockModelRuntime.handlePollVideoStatus.mockResolvedValue({
        status: 'failed',
        error: 'Model API error',
      });

      await processBackgroundVideoPolling(mockDb, mockParams);

      expect(mockAsyncTaskModel.update).toHaveBeenCalledWith('task-123', {
        error: expect.any(AsyncTaskError),
        status: AsyncTaskStatus.Error,
      });

      const errorCall = mockAsyncTaskModel.update.mock.calls[0][1];
      expect(errorCall.error).toBeInstanceOf(AsyncTaskError);
      expect(errorCall.error?.name).toBe('ServerError');
    });

    it('should handle model runtime initialization error', async () => {
      vi.mocked(initModelRuntimeFromDB).mockRejectedValue(new Error('Runtime init failed'));

      await processBackgroundVideoPolling(mockDb, mockParams);

      expect(mockAsyncTaskModel.update).toHaveBeenCalledWith('task-123', {
        error: expect.any(AsyncTaskError),
        status: AsyncTaskStatus.Error,
      });
    });

    it('should handle video processing error', async () => {
      mockModelRuntime.handlePollVideoStatus.mockResolvedValue({
        status: 'success',
        videoUrl: 'https://example.com/video.mp4',
      });

      mockVideoService.processVideoForGeneration.mockRejectedValue(
        new Error('Video processing failed'),
      );

      await processBackgroundVideoPolling(mockDb, mockParams);

      expect(mockAsyncTaskModel.update).toHaveBeenCalledWith('task-123', {
        error: expect.any(AsyncTaskError),
        status: AsyncTaskStatus.Error,
      });
    });

    it('should handle asset creation error', async () => {
      mockModelRuntime.handlePollVideoStatus.mockResolvedValue({
        status: 'success',
        videoUrl: 'https://example.com/video.mp4',
      });

      mockVideoService.processVideoForGeneration.mockResolvedValue({
        coverKey: 'cover-key',
        duration: 10,
        fileHash: 'hash',
        fileSize: 1024,
        height: 1080,
        mimeType: 'video/mp4',
        thumbnailKey: 'thumb-key',
        videoKey: 'video-key',
        width: 1920,
      });

      mockGenerationModel.createAssetAndFile.mockRejectedValue(new Error('DB error'));

      await processBackgroundVideoPolling(mockDb, mockParams);

      expect(mockAsyncTaskModel.update).toHaveBeenCalledWith('task-123', {
        error: expect.any(AsyncTaskError),
        status: AsyncTaskStatus.Error,
      });
    });
  });

  describe('polling edge cases', () => {
    it('should handle network errors during polling gracefully', async () => {
      mockModelRuntime.handlePollVideoStatus
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ status: 'processing' })
        .mockResolvedValueOnce({
          status: 'success',
          videoUrl: 'https://example.com/video.mp4',
        });

      mockVideoService.processVideoForGeneration.mockResolvedValue({
        coverKey: 'cover-key',
        duration: 10,
        fileHash: 'hash',
        fileSize: 1024,
        height: 1080,
        mimeType: 'video/mp4',
        thumbnailKey: 'thumb-key',
        videoKey: 'video-key',
        width: 1920,
      });

      mockGenerationModel.createAssetAndFile.mockResolvedValue(undefined);

      const pollPromise = processBackgroundVideoPolling(mockDb, mockParams);
      await vi.advanceTimersByTimeAsync(10000);
      await pollPromise;

      expect(mockModelRuntime.handlePollVideoStatus).toHaveBeenCalledTimes(3);
      expect(mockAsyncTaskModel.update).toHaveBeenCalledWith(
        'task-123',
        expect.objectContaining({ status: AsyncTaskStatus.Success }),
      );
    });
  });

  describe('async task duration calculation', () => {
    it('should calculate correct duration from start time', async () => {
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-01T00:05:00Z');

      mockModelRuntime.handlePollVideoStatus.mockResolvedValue({
        status: 'success',
        videoUrl: 'https://example.com/video.mp4',
      });

      mockVideoService.processVideoForGeneration.mockResolvedValue({
        coverKey: 'cover-key',
        duration: 10,
        fileHash: 'hash',
        fileSize: 1024,
        height: 1080,
        mimeType: 'video/mp4',
        thumbnailKey: 'thumb-key',
        videoKey: 'video-key',
        width: 1920,
      });

      mockGenerationModel.createAssetAndFile.mockResolvedValue(undefined);

      vi.setSystemTime(endTime);

      await processBackgroundVideoPolling(mockDb, { ...mockParams, asyncTaskCreatedAt: startTime });

      expect(mockAsyncTaskModel.update).toHaveBeenCalledWith(
        'task-123',
        expect.objectContaining({
          duration: expect.any(Number),
          status: AsyncTaskStatus.Success,
        }),
      );
    });
  });
});
