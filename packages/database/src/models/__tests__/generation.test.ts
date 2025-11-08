// @vitest-environment node
import { AsyncTaskStatus, ImageGenerationAsset } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileSource } from '@/types/files';

import {
  NewGeneration,
  asyncTasks,
  files,
  generationBatches,
  generationTopics,
  generations,
  users,
} from '../../schemas';
import { LobeChatDatabase } from '../../type';
import { GenerationModel } from '../generation';
import { getTestDB } from './_util';

const serverDB: LobeChatDatabase = await getTestDB();

// Mock FileService
const mockGetFullFileUrl = vi.fn();
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    getFullFileUrl: mockGetFullFileUrl,
  })),
}));

// Mock FileModel
const mockFileModelCreate = vi.fn();
vi.mock('../file', () => ({
  FileModel: vi.fn().mockImplementation(() => ({
    create: mockFileModelCreate,
  })),
}));

const userId = 'generation-test-user-id';
const otherUserId = 'other-user-id';
const generationModel = new GenerationModel(serverDB, userId);

// Test data
const testTopic = {
  id: 'test-topic-id',
  userId,
  title: 'Test Generation Topic',
  coverUrl: null,
};

const testBatch = {
  id: 'test-batch-id',
  generationTopicId: 'test-topic-id',
  provider: 'test-provider',
  model: 'test-model',
  prompt: 'Test prompt for image generation',
  width: 1024,
  height: 1024,
  config: {},
  userId,
};

const testAsyncTask = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  status: AsyncTaskStatus.Success,
  type: 'imageGeneration',
  params: {},
  error: null,
  userId,
};

const testGeneration: Omit<NewGeneration, 'userId'> = {
  generationBatchId: 'test-batch-id',
  asyncTaskId: '550e8400-e29b-41d4-a716-446655440000', // 使用有效的 asyncTaskId
  fileId: null, // 使用 null 避免外键约束
  seed: 12345,
  asset: {
    url: 'asset-url.jpg',
    thumbnailUrl: 'thumbnail-url.jpg',
    width: 1024,
    height: 1024,
  } as ImageGenerationAsset,
};

const testFile = {
  id: 'test-file-id',
  name: 'generated-image.jpg',
  url: 'https://example.com/generated-image.jpg',
  size: 1048576,
  fileType: 'image/jpeg',
  source: FileSource.ImageGeneration,
  userId,
};

beforeEach(async () => {
  // Clear all mocks
  vi.clearAllMocks();

  // Setup mock return values
  mockGetFullFileUrl.mockImplementation((url: string) => `https://example.com/${url}`);

  // Clear database and create test users
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);

  // Create test topic
  await serverDB.insert(generationTopics).values(testTopic);

  // Create test batch
  await serverDB.insert(generationBatches).values(testBatch);

  // Create test async task
  await serverDB.insert(asyncTasks).values(testAsyncTask);

  // Create test file
  await serverDB.insert(files).values(testFile);

  // Create a file that will be returned by the mock for createAssetAndFile tests
  const mockFileForUpdateTest = {
    id: 'new-file-id',
    name: 'mock-generated-image.jpg',
    url: 'https://example.com/mock-generated-image.jpg',
    size: 1048576,
    fileType: 'image/jpeg',
    source: FileSource.ImageGeneration,
    userId,
  };
  await serverDB.insert(files).values(mockFileForUpdateTest);

  // Setup FileModel mock to return the actual file ID that exists in database
  mockFileModelCreate.mockResolvedValue({ id: 'new-file-id' });
});

afterEach(async () => {
  // Clean up database
  await serverDB.delete(users);
});

describe('GenerationModel', () => {
  describe('create', () => {
    it('should create a new generation', async () => {
      const result = await generationModel.create(testGeneration);

      expect(result.id).toBeDefined();
      expect(result).toMatchObject({
        ...testGeneration,
        userId,
      });

      // Verify in database
      const dbGeneration = await serverDB.query.generations.findFirst({
        where: eq(generations.id, result.id),
      });
      expect(dbGeneration).toMatchObject({
        ...testGeneration,
        userId,
      });
    });

    it('should automatically set userId when creating generation', async () => {
      const result = await generationModel.create(testGeneration);

      expect(result.userId).toBe(userId);
    });

    it('should create generation with minimal data', async () => {
      const minimalGeneration: Omit<NewGeneration, 'userId'> = {
        generationBatchId: 'test-batch-id',
      };

      const result = await generationModel.create(minimalGeneration);

      expect(result.id).toBeDefined();
      expect(result.userId).toBe(userId);
      expect(result.generationBatchId).toBe('test-batch-id');
    });
  });

  describe('findById', () => {
    it('should find a generation by id', async () => {
      const [createdGeneration] = await serverDB
        .insert(generations)
        .values({ ...testGeneration, userId })
        .returning();

      const result = await generationModel.findById(createdGeneration.id);

      expect(result).toMatchObject({
        id: createdGeneration.id,
        ...testGeneration,
        userId,
      });
    });

    it('should return undefined for non-existent generation', async () => {
      const result = await generationModel.findById('non-existent-id');
      expect(result).toBeUndefined();
    });

    it('should NOT find generations from other users', async () => {
      // Create generation for other user
      const [otherUserGeneration] = await serverDB
        .insert(generations)
        .values({ ...testGeneration, userId: otherUserId })
        .returning();

      const result = await generationModel.findById(otherUserGeneration.id);
      expect(result).toBeUndefined();
    });
  });

  describe('findByIdWithAsyncTask', () => {
    it('should find generation with async task data', async () => {
      const [createdGeneration] = await serverDB
        .insert(generations)
        .values({ ...testGeneration, userId })
        .returning();

      const result = await generationModel.findByIdWithAsyncTask(createdGeneration.id);

      expect(result).toMatchObject({
        id: createdGeneration.id,
        ...testGeneration,
        userId,
      });
      expect(result?.asyncTask).toMatchObject({
        id: testAsyncTask.id,
        status: AsyncTaskStatus.Success,
      });
    });

    it('should return undefined for non-existent generation', async () => {
      const result = await generationModel.findByIdWithAsyncTask('non-existent-id');
      expect(result).toBeUndefined();
    });

    it('should NOT find generations from other users', async () => {
      const [otherUserGeneration] = await serverDB
        .insert(generations)
        .values({ ...testGeneration, userId: otherUserId })
        .returning();

      const result = await generationModel.findByIdWithAsyncTask(otherUserGeneration.id);
      expect(result).toBeUndefined();
    });
  });

  describe('update', () => {
    it('should update a generation', async () => {
      const [createdGeneration] = await serverDB
        .insert(generations)
        .values({ ...testGeneration, userId })
        .returning();

      const updateData = {
        seed: 54321,
        asset: {
          url: 'updated-asset.jpg',
          thumbnailUrl: 'updated-thumbnail.jpg',
          width: 512,
          height: 512,
        } as ImageGenerationAsset,
      };

      await generationModel.update(createdGeneration.id, updateData);

      const updatedGeneration = await serverDB.query.generations.findFirst({
        where: eq(generations.id, createdGeneration.id),
      });

      expect(updatedGeneration).toMatchObject({
        ...testGeneration,
        ...updateData,
        userId,
      });
      expect(updatedGeneration?.updatedAt).toBeDefined();
    });

    it('should NOT update generations from other users', async () => {
      // Create generation for other user
      const [otherUserGeneration] = await serverDB
        .insert(generations)
        .values({ ...testGeneration, userId: otherUserId })
        .returning();

      const updateData = { seed: 99999 };

      await generationModel.update(otherUserGeneration.id, updateData);

      // Verify original data unchanged
      const unchanged = await serverDB.query.generations.findFirst({
        where: eq(generations.id, otherUserGeneration.id),
      });
      expect(unchanged?.seed).toBe(testGeneration.seed);
    });

    it('should handle partial updates', async () => {
      const [createdGeneration] = await serverDB
        .insert(generations)
        .values({ ...testGeneration, userId })
        .returning();

      await generationModel.update(createdGeneration.id, { seed: 11111 });

      const updatedGeneration = await serverDB.query.generations.findFirst({
        where: eq(generations.id, createdGeneration.id),
      });

      expect(updatedGeneration?.seed).toBe(11111);
      expect(updatedGeneration?.generationBatchId).toBe(testGeneration.generationBatchId);
    });
  });

  describe('createAssetAndFile', () => {
    it('should update generation asset and create file in transaction', async () => {
      const [createdGeneration] = await serverDB
        .insert(generations)
        .values({ ...testGeneration, userId, asset: null, fileId: null })
        .returning();

      const newAsset = {
        url: 'new-asset.jpg',
        thumbnailUrl: 'new-thumbnail.jpg',
        width: 2048,
        height: 2048,
      } as ImageGenerationAsset;

      const newFileData = {
        name: 'new-generated-image.jpg',
        url: 'https://example.com/new-generated-image.jpg',
        size: 2097152,
        fileType: 'image/jpeg',
      };

      const result = await generationModel.createAssetAndFile(
        createdGeneration.id,
        newAsset,
        newFileData,
      );

      expect(result.file.id).toBe('new-file-id');
      expect(mockFileModelCreate).toHaveBeenCalledWith(
        {
          ...newFileData,
          source: FileSource.ImageGeneration,
        },
        true,
        expect.any(Object), // transaction object
      );

      // Verify generation was updated
      const updatedGeneration = await serverDB.query.generations.findFirst({
        where: eq(generations.id, createdGeneration.id),
      });
      expect(updatedGeneration?.asset).toEqual(newAsset);
      expect(updatedGeneration?.fileId).toBe('new-file-id');
    });

    it('should NOT update assets for other users generations', async () => {
      // Create generation for other user
      const [otherUserGeneration] = await serverDB
        .insert(generations)
        .values({ ...testGeneration, userId: otherUserId, asset: null, fileId: null })
        .returning();

      const newAsset = {
        url: 'hacked-asset.jpg',
        thumbnailUrl: 'hacked-thumbnail.jpg',
        width: 1,
        height: 1,
      } as ImageGenerationAsset;

      const newFileData = {
        name: 'hacked-file.jpg',
        url: 'https://example.com/hacked-file.jpg',
        size: 1,
        fileType: 'image/jpeg',
      };

      await generationModel.createAssetAndFile(otherUserGeneration.id, newAsset, newFileData);

      // Verify no changes to other user's generation
      const unchanged = await serverDB.query.generations.findFirst({
        where: eq(generations.id, otherUserGeneration.id),
      });
      expect(unchanged?.asset).toBeNull();
      expect(unchanged?.fileId).toBeNull();
    });

    it('should handle FileModel errors in transaction', async () => {
      const [createdGeneration] = await serverDB
        .insert(generations)
        .values({ ...testGeneration, userId, asset: null, fileId: null })
        .returning();

      mockFileModelCreate.mockRejectedValue(new Error('File creation failed'));

      const newAsset = {
        url: 'asset.jpg',
        thumbnailUrl: 'thumbnail.jpg',
        width: 1024,
        height: 1024,
      } as ImageGenerationAsset;

      const newFileData = {
        name: 'image.jpg',
        url: 'https://example.com/image.jpg',
        size: 1024,
        fileType: 'image/jpeg',
      };

      await expect(
        generationModel.createAssetAndFile(createdGeneration.id, newAsset, newFileData),
      ).rejects.toThrow('File creation failed');

      // Verify generation was not updated due to transaction rollback
      const unchanged = await serverDB.query.generations.findFirst({
        where: eq(generations.id, createdGeneration.id),
      });
      expect(unchanged?.asset).toBeNull();
      expect(unchanged?.fileId).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete a generation', async () => {
      const [createdGeneration] = await serverDB
        .insert(generations)
        .values({ ...testGeneration, userId })
        .returning();

      const deletedGeneration = await generationModel.delete(createdGeneration.id);

      expect(deletedGeneration.id).toBe(createdGeneration.id);

      const deletedRecord = await serverDB.query.generations.findFirst({
        where: eq(generations.id, createdGeneration.id),
      });
      expect(deletedRecord).toBeUndefined();
    });

    it('should NOT delete generations from other users', async () => {
      // Create generation for other user
      const [otherUserGeneration] = await serverDB
        .insert(generations)
        .values({ ...testGeneration, userId: otherUserId })
        .returning();

      const result = await generationModel.delete(otherUserGeneration.id);

      expect(result).toBeUndefined();

      // Verify generation still exists
      const stillExists = await serverDB.query.generations.findFirst({
        where: eq(generations.id, otherUserGeneration.id),
      });
      expect(stillExists).toBeDefined();
    });

    it('should return undefined when trying to delete non-existent generation', async () => {
      const result = await generationModel.delete('non-existent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('findByIdAndTransform', () => {
    it('should find and transform generation to frontend type', async () => {
      const [createdGeneration] = await serverDB
        .insert(generations)
        .values({ ...testGeneration, userId })
        .returning();

      const result = await generationModel.findByIdAndTransform(createdGeneration.id);

      expect(result).toMatchObject({
        id: createdGeneration.id,
        asset: {
          url: 'https://example.com/asset-url.jpg',
          thumbnailUrl: 'https://example.com/thumbnail-url.jpg',
          width: 1024,
          height: 1024,
        },
        seed: testGeneration.seed,
        asyncTaskId: testGeneration.asyncTaskId,
        task: {
          id: testGeneration.asyncTaskId,
          status: AsyncTaskStatus.Success,
        },
      });

      expect(mockGetFullFileUrl).toHaveBeenCalledWith('asset-url.jpg');
      expect(mockGetFullFileUrl).toHaveBeenCalledWith('thumbnail-url.jpg');
    });

    it('should return null for non-existent generation', async () => {
      const result = await generationModel.findByIdAndTransform('non-existent-id');
      expect(result).toBeNull();
    });

    it('should NOT transform generations from other users', async () => {
      const [otherUserGeneration] = await serverDB
        .insert(generations)
        .values({ ...testGeneration, userId: otherUserId })
        .returning();

      const result = await generationModel.findByIdAndTransform(otherUserGeneration.id);
      expect(result).toBeNull();
    });
  });

  describe('transformGeneration', () => {
    it('should transform generation with asset URLs', async () => {
      const generationWithTask = {
        id: 'test-gen-id',
        userId,
        generationBatchId: 'batch-id',
        asyncTaskId: '550e8400-e29b-41d4-a716-446655440000',
        fileId: 'file-id',
        seed: 12345,
        asset: {
          url: 'original-asset.jpg',
          thumbnailUrl: 'original-thumbnail.jpg',
          width: 1024,
          height: 1024,
        } as ImageGenerationAsset,
        accessedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        asyncTask: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          status: AsyncTaskStatus.Success,
          type: 'imageGeneration',
          params: {},
          error: null,
          duration: null,
          accessedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          userId,
        },
      };

      const result = await generationModel.transformGeneration(generationWithTask);

      expect(result).toMatchObject({
        id: 'test-gen-id',
        asset: {
          url: 'https://example.com/original-asset.jpg',
          thumbnailUrl: 'https://example.com/original-thumbnail.jpg',
          width: 1024,
          height: 1024,
        },
        seed: 12345,
        asyncTaskId: '550e8400-e29b-41d4-a716-446655440000',
        task: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          status: AsyncTaskStatus.Success,
        },
      });

      expect(mockGetFullFileUrl).toHaveBeenCalledWith('original-asset.jpg');
      expect(mockGetFullFileUrl).toHaveBeenCalledWith('original-thumbnail.jpg');
    });

    it('should handle generation without asset', async () => {
      const generationWithoutAsset = {
        id: 'test-gen-id',
        userId,
        generationBatchId: 'batch-id',
        asyncTaskId: '550e8400-e29b-41d4-a716-446655440000',
        fileId: null,
        seed: 12345,
        asset: null,
        accessedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        asyncTask: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          status: AsyncTaskStatus.Pending,
          type: 'imageGeneration',
          params: {},
          error: null,
          duration: null,
          accessedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          userId,
        },
      };

      const result = await generationModel.transformGeneration(generationWithoutAsset as any);

      expect(result).toMatchObject({
        id: 'test-gen-id',
        asset: null,
        seed: 12345,
        asyncTaskId: '550e8400-e29b-41d4-a716-446655440000',
        task: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          status: AsyncTaskStatus.Pending,
        },
      });

      expect(mockGetFullFileUrl).not.toHaveBeenCalled();
    });

    it('should handle generation without async task', async () => {
      const generationWithoutTask = {
        id: 'test-gen-id',
        userId,
        generationBatchId: 'batch-id',
        asyncTaskId: null,
        fileId: null,
        seed: 12345,
        asset: null,
        accessedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        asyncTask: undefined,
      };

      const result = await generationModel.transformGeneration(generationWithoutTask as any);

      expect(result).toMatchObject({
        id: 'test-gen-id',
        asset: null,
        seed: 12345,
        asyncTaskId: null,
        task: {
          id: '',
          status: 'pending',
        },
      });
    });

    it('should handle FileService errors during transformation', async () => {
      mockGetFullFileUrl.mockRejectedValue(new Error('FileService error'));

      const generationWithAsset = {
        id: 'test-gen-id',
        userId,
        generationBatchId: 'batch-id',
        asyncTaskId: null,
        fileId: null,
        seed: 12345,
        asset: {
          url: 'failing-asset.jpg',
          thumbnailUrl: 'failing-thumbnail.jpg',
          width: 1024,
          height: 1024,
        } as ImageGenerationAsset,
        accessedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        asyncTask: undefined,
      };

      await expect(generationModel.transformGeneration(generationWithAsset as any)).rejects.toThrow(
        'FileService error',
      );
    });
  });

  describe('user isolation security tests', () => {
    it('should enforce user data isolation across all methods', async () => {
      // Create generations for both users
      const userGeneration = { ...testGeneration, userId };
      const otherUserGeneration = { ...testGeneration, userId: otherUserId };

      const [userGenerationCreated] = await serverDB
        .insert(generations)
        .values(userGeneration)
        .returning();

      const [otherUserGenerationCreated] = await serverDB
        .insert(generations)
        .values(otherUserGeneration)
        .returning();

      // Test findById isolation
      const foundUserGeneration = await generationModel.findById(userGenerationCreated.id);
      const foundOtherGeneration = await generationModel.findById(otherUserGenerationCreated.id);

      expect(foundUserGeneration).toBeDefined();
      expect(foundOtherGeneration).toBeUndefined(); // Should not find other user's generation

      // Test findByIdWithAsyncTask isolation
      const foundUserGenerationWithTask = await generationModel.findByIdWithAsyncTask(
        userGenerationCreated.id,
      );
      const foundOtherGenerationWithTask = await generationModel.findByIdWithAsyncTask(
        otherUserGenerationCreated.id,
      );

      expect(foundUserGenerationWithTask).toBeDefined();
      expect(foundOtherGenerationWithTask).toBeUndefined();

      // Test findByIdAndTransform isolation
      const transformedUserGeneration = await generationModel.findByIdAndTransform(
        userGenerationCreated.id,
      );
      const transformedOtherGeneration = await generationModel.findByIdAndTransform(
        otherUserGenerationCreated.id,
      );

      expect(transformedUserGeneration).toBeDefined();
      expect(transformedOtherGeneration).toBeNull();

      // Test update isolation - should not affect other user's data
      await generationModel.update(otherUserGenerationCreated.id, { seed: 99999 });
      const otherUserGenerationUnchanged = await serverDB.query.generations.findFirst({
        where: eq(generations.id, otherUserGenerationCreated.id),
      });
      expect(otherUserGenerationUnchanged?.seed).toBe(testGeneration.seed); // Should not be updated

      // Test delete isolation - should not affect other user's data
      await generationModel.delete(otherUserGenerationCreated.id);
      const otherUserGenerationStillExists = await serverDB.query.generations.findFirst({
        where: eq(generations.id, otherUserGenerationCreated.id),
      });
      expect(otherUserGenerationStillExists).toBeDefined(); // Should not be deleted
    });
  });

  describe('External service integration', () => {
    it('should call FileService with correct parameters', async () => {
      const [createdGeneration] = await serverDB
        .insert(generations)
        .values({ ...testGeneration, userId })
        .returning();

      await generationModel.findByIdAndTransform(createdGeneration.id);

      expect(mockGetFullFileUrl).toHaveBeenCalledWith('asset-url.jpg');
      expect(mockGetFullFileUrl).toHaveBeenCalledWith('thumbnail-url.jpg');
      expect(mockGetFullFileUrl).toHaveBeenCalledTimes(2);
    });

    it('should call FileModel.create with correct parameters during createAssetAndFile', async () => {
      const [createdGeneration] = await serverDB
        .insert(generations)
        .values({ ...testGeneration, userId, asset: null, fileId: null })
        .returning();

      const asset = {
        url: 'new-asset.jpg',
        thumbnailUrl: 'new-thumbnail.jpg',
        width: 1024,
        height: 1024,
      } as ImageGenerationAsset;

      const fileData = {
        name: 'test-image.jpg',
        url: 'https://example.com/test-image.jpg',
        size: 1024,
        fileType: 'image/jpeg',
      };

      await generationModel.createAssetAndFile(createdGeneration.id, asset, fileData);

      expect(mockFileModelCreate).toHaveBeenCalledWith(
        {
          ...fileData,
          source: FileSource.ImageGeneration,
        },
        true,
        expect.any(Object),
      );
      expect(mockFileModelCreate).toHaveBeenCalledTimes(1);
    });

    it('should handle FileService errors gracefully', async () => {
      mockGetFullFileUrl.mockRejectedValue(new Error('FileService error'));

      const [createdGeneration] = await serverDB
        .insert(generations)
        .values({ ...testGeneration, userId })
        .returning();

      await expect(generationModel.findByIdAndTransform(createdGeneration.id)).rejects.toThrow(
        'FileService error',
      );
    });
  });
});
