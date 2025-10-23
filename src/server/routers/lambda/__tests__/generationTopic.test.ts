import { describe, expect, it, vi } from 'vitest';

import { GenerationTopicModel } from '@/database/models/generationTopic';
import { GenerationTopicItem } from '@/database/schemas/generation';
import { FileService } from '@/server/services/file';
import { GenerationService } from '@/server/services/generation';

import { generationTopicRouter } from '../generationTopic';

vi.mock('@/database/models/generationTopic');
vi.mock('@/server/services/file');
vi.mock('@/server/services/generation');

describe('generationTopicRouter', () => {
  const mockCtx = {
    userId: 'test-user',
    serverDB: {} as any,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a new topic', async () => {
    const mockTopicId = 'topic-123';
    const mockCreatedTopic = {
      id: mockTopicId,
      title: '',
      userId: 'test-user',
      coverUrl: null,
      accessedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockCreate = vi.fn().mockResolvedValue(mockCreatedTopic);
    vi.mocked(GenerationTopicModel).mockImplementation(
      () =>
        ({
          create: mockCreate,
        }) as any,
    );

    const caller = generationTopicRouter.createCaller(mockCtx);
    const result = await caller.createTopic();

    expect(result).toBe(mockTopicId);
    expect(mockCreate).toHaveBeenCalledWith('');
  });

  it('should get all generation topics', async () => {
    const mockTopics: GenerationTopicItem[] = [
      {
        id: 'topic-1',
        title: 'Test Topic 1',
        userId: 'test-user',
        coverUrl: 'cover-url-1',
        accessedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'topic-2',
        title: 'Test Topic 2',
        userId: 'test-user',
        coverUrl: null,
        accessedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const mockQueryAll = vi.fn().mockResolvedValue(mockTopics);
    vi.mocked(GenerationTopicModel).mockImplementation(
      () =>
        ({
          queryAll: mockQueryAll,
        }) as any,
    );

    const caller = generationTopicRouter.createCaller(mockCtx);
    const result = await caller.getAllGenerationTopics();

    expect(result).toEqual(mockTopics);
    expect(mockQueryAll).toHaveBeenCalled();
  });

  it('should update a topic', async () => {
    const mockTopicId = 'topic-123';
    const mockUpdateValue = {
      title: 'Updated Title',
      coverUrl: 'updated-cover-url',
    };
    const mockUpdatedTopic = {
      id: mockTopicId,
      ...mockUpdateValue,
      userId: 'test-user',
      accessedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockUpdate = vi.fn().mockResolvedValue(mockUpdatedTopic);
    vi.mocked(GenerationTopicModel).mockImplementation(
      () =>
        ({
          update: mockUpdate,
        }) as any,
    );

    const caller = generationTopicRouter.createCaller(mockCtx);
    const result = await caller.updateTopic({
      id: mockTopicId,
      value: mockUpdateValue,
    });

    expect(result).toEqual(mockUpdatedTopic);
    expect(mockUpdate).toHaveBeenCalledWith(mockTopicId, mockUpdateValue);
  });

  it('should update topic cover', async () => {
    const mockTopicId = 'topic-123';
    const mockCoverUrl = 'https://example.com/cover.jpg';
    const mockNewCoverKey = 'generations/covers/new-cover-key.webp';
    const mockUpdatedTopic = {
      id: mockTopicId,
      title: 'Test Topic',
      userId: 'test-user',
      coverUrl: mockNewCoverKey,
      accessedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockCreateCoverFromUrl = vi.fn().mockResolvedValue(mockNewCoverKey);
    const mockUpdate = vi.fn().mockResolvedValue(mockUpdatedTopic);

    vi.mocked(GenerationService).mockImplementation(
      () =>
        ({
          createCoverFromUrl: mockCreateCoverFromUrl,
        }) as any,
    );

    vi.mocked(GenerationTopicModel).mockImplementation(
      () =>
        ({
          update: mockUpdate,
        }) as any,
    );

    const caller = generationTopicRouter.createCaller(mockCtx);
    const result = await caller.updateTopicCover({
      id: mockTopicId,
      coverUrl: mockCoverUrl,
    });

    expect(result).toEqual(mockUpdatedTopic);
    expect(mockCreateCoverFromUrl).toHaveBeenCalledWith(mockCoverUrl);
    expect(mockUpdate).toHaveBeenCalledWith(mockTopicId, { coverUrl: mockNewCoverKey });
  });

  it('should delete a topic without cover', async () => {
    const mockTopicId = 'topic-123';
    const mockDeletedTopic = {
      id: mockTopicId,
      title: 'Deleted Topic',
      userId: 'test-user',
      coverUrl: null,
      accessedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // 修复 Mock 返回结构以匹配新的实现
    const mockDelete = vi.fn().mockResolvedValue({
      deletedTopic: mockDeletedTopic,
      filesToDelete: [], // 没有封面时，文件列表为空
    });
    const mockDeleteFiles = vi.fn();

    vi.mocked(GenerationTopicModel).mockImplementation(
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

    const caller = generationTopicRouter.createCaller(mockCtx);
    const result = await caller.deleteTopic({ id: mockTopicId });

    expect(result).toEqual(mockDeletedTopic);
    expect(mockDelete).toHaveBeenCalledWith(mockTopicId);
    expect(mockDeleteFiles).not.toHaveBeenCalled(); // 没有文件要删除
  });

  it('should delete a topic with cover and remove the cover file', async () => {
    const mockTopicId = 'topic-123';
    const mockCoverUrl = 'generations/covers/cover-key.webp';
    const mockDeletedTopic = {
      id: mockTopicId,
      title: 'Deleted Topic',
      userId: 'test-user',
      coverUrl: mockCoverUrl,
      accessedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // 修复 Mock 返回结构以匹配新的实现
    const mockDelete = vi.fn().mockResolvedValue({
      deletedTopic: mockDeletedTopic,
      filesToDelete: [mockCoverUrl], // 包含需要删除的封面文件
    });
    const mockDeleteFiles = vi.fn().mockResolvedValue(true);

    vi.mocked(GenerationTopicModel).mockImplementation(
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

    const caller = generationTopicRouter.createCaller(mockCtx);
    const result = await caller.deleteTopic({ id: mockTopicId });

    expect(result).toEqual(mockDeletedTopic);
    expect(mockDelete).toHaveBeenCalledWith(mockTopicId);
    expect(mockDeleteFiles).toHaveBeenCalledWith([mockCoverUrl]); // 验证文件删除调用
  });

  it('should still return deleted topic when file deletion fails', async () => {
    const mockTopicId = 'topic-123';
    const mockCoverUrl = 'generations/covers/cover-key.webp';
    const mockDeletedTopic = {
      id: mockTopicId,
      title: 'Deleted Topic',
      userId: 'test-user',
      coverUrl: mockCoverUrl,
      accessedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockDelete = vi.fn().mockResolvedValue({
      deletedTopic: mockDeletedTopic,
      filesToDelete: [mockCoverUrl],
    });

    // Mock file deletion to fail
    const mockDeleteFiles = vi.fn().mockRejectedValue(new Error('S3 deletion failed'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.mocked(GenerationTopicModel).mockImplementation(
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

    const caller = generationTopicRouter.createCaller(mockCtx);
    const result = await caller.deleteTopic({ id: mockTopicId });

    // Database deletion should succeed even if file deletion fails
    expect(result).toEqual(mockDeletedTopic);
    expect(mockDelete).toHaveBeenCalledWith(mockTopicId);
    expect(mockDeleteFiles).toHaveBeenCalledWith([mockCoverUrl]);
    expect(consoleSpy).toHaveBeenCalledWith('Failed to delete files from S3:', expect.any(Error));

    consoleSpy.mockRestore();
  });

  it('should handle topic with multiple files (cover + thumbnails)', async () => {
    const mockTopicId = 'topic-123';
    const mockCoverUrl = 'generations/covers/cover-key.webp';
    const mockThumbnailUrls = ['thumb1.jpg', 'thumb2.jpg', 'thumb3.jpg'];
    const mockDeletedTopic = {
      id: mockTopicId,
      title: 'Deleted Topic with Multiple Files',
      userId: 'test-user',
      coverUrl: mockCoverUrl,
      accessedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockDelete = vi.fn().mockResolvedValue({
      deletedTopic: mockDeletedTopic,
      filesToDelete: [mockCoverUrl, ...mockThumbnailUrls], // 包含封面和缩略图
    });
    const mockDeleteFiles = vi.fn().mockResolvedValue(true);

    vi.mocked(GenerationTopicModel).mockImplementation(
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

    const caller = generationTopicRouter.createCaller(mockCtx);
    const result = await caller.deleteTopic({ id: mockTopicId });

    expect(result).toEqual(mockDeletedTopic);
    expect(mockDelete).toHaveBeenCalledWith(mockTopicId);
    expect(mockDeleteFiles).toHaveBeenCalledWith([mockCoverUrl, ...mockThumbnailUrls]);
  });

  it('should handle partial file deletion failure gracefully', async () => {
    const mockTopicId = 'topic-123';
    const mockCoverUrl = 'generations/covers/cover-key.webp';
    const mockThumbnailUrls = ['thumb1.jpg', 'thumb2.jpg'];
    const mockDeletedTopic = {
      id: mockTopicId,
      title: 'Deleted Topic',
      userId: 'test-user',
      coverUrl: mockCoverUrl,
      accessedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockDelete = vi.fn().mockResolvedValue({
      deletedTopic: mockDeletedTopic,
      filesToDelete: [mockCoverUrl, ...mockThumbnailUrls],
    });

    // Mock partial failure - some files deleted, others failed
    const mockDeleteFiles = vi
      .fn()
      .mockRejectedValue(new Error('Some files could not be deleted from S3'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.mocked(GenerationTopicModel).mockImplementation(
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

    const caller = generationTopicRouter.createCaller(mockCtx);
    const result = await caller.deleteTopic({ id: mockTopicId });

    // Even with partial file deletion failure, topic deletion should succeed
    expect(result).toEqual(mockDeletedTopic);
    expect(mockDelete).toHaveBeenCalledWith(mockTopicId);
    expect(mockDeleteFiles).toHaveBeenCalledWith([mockCoverUrl, ...mockThumbnailUrls]);
    expect(consoleSpy).toHaveBeenCalledWith('Failed to delete files from S3:', expect.any(Error));

    consoleSpy.mockRestore();
  });

  it('should return undefined when deleting non-existent topic', async () => {
    const mockTopicId = 'non-existent-topic';

    // Mock delete method to return undefined for non-existent topic
    const mockDelete = vi.fn().mockResolvedValue(undefined);
    const mockDeleteFiles = vi.fn();

    vi.mocked(GenerationTopicModel).mockImplementation(
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

    const caller = generationTopicRouter.createCaller(mockCtx);

    // Expect the function to return undefined for non-existent topic
    const result = await caller.deleteTopic({ id: mockTopicId });
    expect(result).toBeUndefined();

    expect(mockDelete).toHaveBeenCalledWith(mockTopicId);
    expect(mockDeleteFiles).not.toHaveBeenCalled(); // 没有文件要删除
  });

  it('should handle edge cases for update with partial data', async () => {
    const mockTopicId = 'topic-123';
    const mockUpdateValue = {
      title: 'Only Title Updated',
    };
    const mockUpdatedTopic = {
      id: mockTopicId,
      title: 'Only Title Updated',
      userId: 'test-user',
      coverUrl: null,
      accessedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockUpdate = vi.fn().mockResolvedValue(mockUpdatedTopic);
    vi.mocked(GenerationTopicModel).mockImplementation(
      () =>
        ({
          update: mockUpdate,
        }) as any,
    );

    const caller = generationTopicRouter.createCaller(mockCtx);
    const result = await caller.updateTopic({
      id: mockTopicId,
      value: mockUpdateValue,
    });

    expect(result).toEqual(mockUpdatedTopic);
    expect(mockUpdate).toHaveBeenCalledWith(mockTopicId, mockUpdateValue);
  });

  it('should handle null values in update', async () => {
    const mockTopicId = 'topic-123';
    const mockUpdateValue = {
      title: null,
      coverUrl: null,
    };
    const mockUpdatedTopic = {
      id: mockTopicId,
      title: null,
      userId: 'test-user',
      coverUrl: null,
      accessedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockUpdate = vi.fn().mockResolvedValue(mockUpdatedTopic);
    vi.mocked(GenerationTopicModel).mockImplementation(
      () =>
        ({
          update: mockUpdate,
        }) as any,
    );

    const caller = generationTopicRouter.createCaller(mockCtx);
    const result = await caller.updateTopic({
      id: mockTopicId,
      value: mockUpdateValue,
    });

    expect(result).toEqual(mockUpdatedTopic);
    expect(mockUpdate).toHaveBeenCalledWith(mockTopicId, mockUpdateValue);
  });

  it('should return undefined when updating non-existent topic', async () => {
    const mockTopicId = 'non-existent-topic';
    const mockUpdateValue = {
      title: 'New Title',
    };

    const mockUpdate = vi.fn().mockResolvedValue(undefined);
    vi.mocked(GenerationTopicModel).mockImplementation(
      () =>
        ({
          update: mockUpdate,
        }) as any,
    );

    const caller = generationTopicRouter.createCaller(mockCtx);
    const result = await caller.updateTopic({
      id: mockTopicId,
      value: mockUpdateValue,
    });

    expect(result).toBeUndefined();
    expect(mockUpdate).toHaveBeenCalledWith(mockTopicId, mockUpdateValue);
  });
});
