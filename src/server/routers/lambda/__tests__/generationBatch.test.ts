import { describe, expect, it, vi } from 'vitest';

import { GenerationBatchModel } from '@/database/models/generationBatch';
import { type GenerationBatchItem } from '@/database/schemas/generation';
import { FileService } from '@/server/services/file';

import { generationBatchRouter } from '../generationBatch';

vi.mock('@/database/models/generationBatch');
vi.mock('@/server/services/file');

describe('generationBatchRouter', () => {
  const mockCtx = {
    userId: 'test-user',
    serverDB: {} as any,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should get generation batches by topic id', async () => {
    const mockBatches = [
      {
        id: 'batch-1',
        topicId: 'topic-1',
        prompt: 'Test prompt',
        generations: [
          { id: 'gen-1', batchId: 'batch-1' },
          { id: 'gen-2', batchId: 'batch-1' },
        ],
      },
      {
        id: 'batch-2',
        topicId: 'topic-1',
        prompt: 'Another prompt',
        generations: [{ id: 'gen-3', batchId: 'batch-2' }],
      },
    ];

    const mockQuery = vi.fn().mockResolvedValue(mockBatches);
    vi.mocked(GenerationBatchModel).mockImplementation(
      () =>
        ({
          queryGenerationBatchesByTopicIdWithGenerations: mockQuery,
        }) as any,
    );

    const caller = generationBatchRouter.createCaller(mockCtx);

    const result = await caller.getGenerationBatches({ topicId: 'topic-1' });

    expect(result).toEqual(mockBatches);
    expect(mockQuery).toHaveBeenCalledWith('topic-1');
  });

  it('should delete generation batch without thumbnails', async () => {
    const mockBatchId = 'batch-123';
    const mockDeletedBatch: GenerationBatchItem = {
      id: mockBatchId,
      userId: 'test-user',
      generationTopicId: 'topic-1',
      provider: 'test-provider',
      model: 'test-model',
      prompt: 'Test prompt',
      width: 1024,
      height: 1024,
      ratio: null,
      config: null,
      accessedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockDelete = vi.fn().mockResolvedValue({
      deletedBatch: mockDeletedBatch,
      thumbnailUrls: [], // 没有缩略图
    });
    const mockDeleteFiles = vi.fn();

    vi.mocked(GenerationBatchModel).mockImplementation(
      () =>
        ({
          delete: mockDelete,
        }) as any,
    );

    vi.mocked(FileService).mockImplementation(
      () =>
        ({
          deleteFiles: mockDeleteFiles,
        }) as any,
    );

    const caller = generationBatchRouter.createCaller(mockCtx);
    const result = await caller.deleteGenerationBatch({ batchId: mockBatchId });

    expect(result).toEqual(mockDeletedBatch);
    expect(mockDelete).toHaveBeenCalledWith(mockBatchId);
    expect(mockDeleteFiles).not.toHaveBeenCalled(); // 没有文件要删除
  });

  it('should delete generation batch with thumbnails', async () => {
    const mockBatchId = 'batch-123';
    const mockThumbnailUrls = ['thumb1.jpg', 'thumb2.jpg', 'thumb3.jpg'];
    const mockDeletedBatch: GenerationBatchItem = {
      id: mockBatchId,
      userId: 'test-user',
      generationTopicId: 'topic-1',
      provider: 'test-provider',
      model: 'test-model',
      prompt: 'Test prompt',
      width: 1024,
      height: 1024,
      ratio: null,
      config: null,
      accessedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockDelete = vi.fn().mockResolvedValue({
      deletedBatch: mockDeletedBatch,
      thumbnailUrls: mockThumbnailUrls,
    });
    const mockDeleteFiles = vi.fn().mockResolvedValue(true);

    vi.mocked(GenerationBatchModel).mockImplementation(
      () =>
        ({
          delete: mockDelete,
        }) as any,
    );

    vi.mocked(FileService).mockImplementation(
      () =>
        ({
          deleteFiles: mockDeleteFiles,
        }) as any,
    );

    const caller = generationBatchRouter.createCaller(mockCtx);
    const result = await caller.deleteGenerationBatch({ batchId: mockBatchId });

    expect(result).toEqual(mockDeletedBatch);
    expect(mockDelete).toHaveBeenCalledWith(mockBatchId);
    expect(mockDeleteFiles).toHaveBeenCalledWith(mockThumbnailUrls);
  });

  it('should still return deleted batch when thumbnail deletion fails', async () => {
    const mockBatchId = 'batch-123';
    const mockThumbnailUrls = ['thumb1.jpg', 'thumb2.jpg'];
    const mockDeletedBatch: GenerationBatchItem = {
      id: mockBatchId,
      userId: 'test-user',
      generationTopicId: 'topic-1',
      provider: 'test-provider',
      model: 'test-model',
      prompt: 'Test prompt',
      width: 1024,
      height: 1024,
      ratio: null,
      config: null,
      accessedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockDelete = vi.fn().mockResolvedValue({
      deletedBatch: mockDeletedBatch,
      thumbnailUrls: mockThumbnailUrls,
    });

    // Mock thumbnail deletion to fail
    const mockDeleteFiles = vi.fn().mockRejectedValue(new Error('S3 thumbnail deletion failed'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.mocked(GenerationBatchModel).mockImplementation(
      () =>
        ({
          delete: mockDelete,
        }) as any,
    );

    vi.mocked(FileService).mockImplementation(
      () =>
        ({
          deleteFiles: mockDeleteFiles,
        }) as any,
    );

    const caller = generationBatchRouter.createCaller(mockCtx);
    const result = await caller.deleteGenerationBatch({ batchId: mockBatchId });

    // Database deletion should succeed even if thumbnail deletion fails
    expect(result).toEqual(mockDeletedBatch);
    expect(mockDelete).toHaveBeenCalledWith(mockBatchId);
    expect(mockDeleteFiles).toHaveBeenCalledWith(mockThumbnailUrls);
    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to delete thumbnail files from S3:',
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });

  it('should return undefined when deleting non-existent batch', async () => {
    const mockBatchId = 'non-existent-batch';

    const mockDelete = vi.fn().mockResolvedValue(undefined);
    const mockDeleteFiles = vi.fn();

    vi.mocked(GenerationBatchModel).mockImplementation(
      () =>
        ({
          delete: mockDelete,
        }) as any,
    );

    vi.mocked(FileService).mockImplementation(
      () =>
        ({
          deleteFiles: mockDeleteFiles,
        }) as any,
    );

    const caller = generationBatchRouter.createCaller(mockCtx);
    const result = await caller.deleteGenerationBatch({ batchId: mockBatchId });

    expect(result).toBeUndefined();
    expect(mockDelete).toHaveBeenCalledWith(mockBatchId);
    expect(mockDeleteFiles).not.toHaveBeenCalled(); // 没有文件要删除
  });

  it('should handle large number of thumbnails deletion', async () => {
    const mockBatchId = 'batch-with-many-thumbnails';
    // 模拟包含大量缩略图的批次
    const mockThumbnailUrls = Array.from({ length: 50 }, (_, i) => `thumb${i + 1}.jpg`);
    const mockDeletedBatch: GenerationBatchItem = {
      id: mockBatchId,
      userId: 'test-user',
      generationTopicId: 'topic-1',
      provider: 'test-provider',
      model: 'test-model',
      prompt: 'Batch with many generations',
      width: 1024,
      height: 1024,
      ratio: null,
      config: null,
      accessedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockDelete = vi.fn().mockResolvedValue({
      deletedBatch: mockDeletedBatch,
      thumbnailUrls: mockThumbnailUrls,
    });
    const mockDeleteFiles = vi.fn().mockResolvedValue(true);

    vi.mocked(GenerationBatchModel).mockImplementation(
      () =>
        ({
          delete: mockDelete,
        }) as any,
    );

    vi.mocked(FileService).mockImplementation(
      () =>
        ({
          deleteFiles: mockDeleteFiles,
        }) as any,
    );

    const caller = generationBatchRouter.createCaller(mockCtx);
    const result = await caller.deleteGenerationBatch({ batchId: mockBatchId });

    expect(result).toEqual(mockDeletedBatch);
    expect(mockDelete).toHaveBeenCalledWith(mockBatchId);
    expect(mockDeleteFiles).toHaveBeenCalledWith(mockThumbnailUrls);
    expect(mockDeleteFiles).toHaveBeenCalledTimes(1);
  });

  it('should handle empty generation batches result', async () => {
    const mockQuery = vi.fn().mockResolvedValue([]);
    vi.mocked(GenerationBatchModel).mockImplementation(
      () =>
        ({
          queryGenerationBatchesByTopicIdWithGenerations: mockQuery,
        }) as any,
    );

    const caller = generationBatchRouter.createCaller(mockCtx);

    const result = await caller.getGenerationBatches({ topicId: 'non-existent-topic' });

    expect(result).toEqual([]);
    expect(mockQuery).toHaveBeenCalledWith('non-existent-topic');
  });

  it('should handle query error gracefully', async () => {
    const mockQuery = vi.fn().mockRejectedValue(new Error('Database connection failed'));
    vi.mocked(GenerationBatchModel).mockImplementation(
      () =>
        ({
          queryGenerationBatchesByTopicIdWithGenerations: mockQuery,
        }) as any,
    );

    const caller = generationBatchRouter.createCaller(mockCtx);

    await expect(caller.getGenerationBatches({ topicId: 'topic-1' })).rejects.toThrow(
      'Database connection failed',
    );
    expect(mockQuery).toHaveBeenCalledWith('topic-1');
  });

  it('should handle partial thumbnail deletion failure gracefully', async () => {
    const mockBatchId = 'batch-123';
    const mockThumbnailUrls = ['thumb1.jpg', 'thumb2.jpg', 'thumb3.jpg'];
    const mockDeletedBatch: GenerationBatchItem = {
      id: mockBatchId,
      userId: 'test-user',
      generationTopicId: 'topic-1',
      provider: 'test-provider',
      model: 'test-model',
      prompt: 'Test prompt',
      width: 1024,
      height: 1024,
      ratio: null,
      config: null,
      accessedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockDelete = vi.fn().mockResolvedValue({
      deletedBatch: mockDeletedBatch,
      thumbnailUrls: mockThumbnailUrls,
    });

    // Mock partial failure - some thumbnails could not be deleted
    const mockDeleteFiles = vi
      .fn()
      .mockRejectedValue(new Error('Some thumbnails could not be deleted from S3'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.mocked(GenerationBatchModel).mockImplementation(
      () =>
        ({
          delete: mockDelete,
        }) as any,
    );

    vi.mocked(FileService).mockImplementation(
      () =>
        ({
          deleteFiles: mockDeleteFiles,
        }) as any,
    );

    const caller = generationBatchRouter.createCaller(mockCtx);
    const result = await caller.deleteGenerationBatch({ batchId: mockBatchId });

    // Even with partial thumbnail deletion failure, batch deletion should succeed
    expect(result).toEqual(mockDeletedBatch);
    expect(mockDelete).toHaveBeenCalledWith(mockBatchId);
    expect(mockDeleteFiles).toHaveBeenCalledWith(mockThumbnailUrls);
    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to delete thumbnail files from S3:',
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });
});
