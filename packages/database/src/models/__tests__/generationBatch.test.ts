// @vitest-environment node
import { GenerationConfig } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AsyncTaskStatus } from '@/types/asyncTask';

import {
  NewGenerationBatch,
  generationBatches,
  generationTopics,
  generations,
  users,
} from '../../schemas';
import { LobeChatDatabase } from '../../type';
import { GenerationBatchModel } from '../generationBatch';
import { getTestDB } from './_util';

const serverDB: LobeChatDatabase = await getTestDB();

// Mock FileService
const mockGetFullFileUrl = vi.fn();
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    getFullFileUrl: mockGetFullFileUrl,
  })),
}));

// Mock GenerationModel
const mockTransformGeneration = vi.fn();
vi.mock('../generation', () => ({
  GenerationModel: vi.fn().mockImplementation(() => ({
    transformGeneration: mockTransformGeneration,
  })),
}));

const userId = 'generation-batch-test-user-id';
const otherUserId = 'other-user-id';
const generationBatchModel = new GenerationBatchModel(serverDB, userId);

// Test data
const testTopic = {
  id: 'test-topic-id',
  userId,
  title: 'Test Generation Topic',
  coverUrl: null,
};

const testBatch: NewGenerationBatch = {
  userId, // Required by schema, but will be overridden by model
  generationTopicId: 'test-topic-id',
  provider: 'test-provider',
  model: 'test-model',
  prompt: 'Test prompt for image generation',
  width: 1024,
  height: 1024,
  config: {
    prompt: 'Test prompt for image generation',
    imageUrls: ['image1.jpg', 'image2.jpg'],
    width: 1024,
    height: 1024,
  } as GenerationConfig,
};

const testGeneration = {
  id: 'test-gen-id',
  generationBatchId: 'test-batch-id',
  asyncTaskId: null, // Use null instead of invalid foreign key
  fileId: null, // Use null instead of invalid foreign key
  seed: 12345,
  asset: {
    type: 'image',
    url: 'asset-url.jpg',
    thumbnailUrl: 'thumbnail-url.jpg',
    width: 1024,
    height: 1024,
  },
  userId,
};

beforeEach(async () => {
  // Clear all mocks
  vi.clearAllMocks();

  // Setup mock return values
  mockGetFullFileUrl.mockImplementation((url: string) => `https://example.com/${url}`);
  mockTransformGeneration.mockResolvedValue({
    id: testGeneration.id,
    asset: {
      url: 'https://example.com/asset-url.jpg',
      thumbnailUrl: 'https://example.com/thumbnail-url.jpg',
      width: 1024,
      height: 1024,
    },
    seed: testGeneration.seed,
    createdAt: new Date(),
    asyncTaskId: testGeneration.asyncTaskId,
    task: {
      id: testGeneration.asyncTaskId,
      status: AsyncTaskStatus.Success,
    },
  });

  // Clear database and create test users
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);

  // Create test topic
  await serverDB.insert(generationTopics).values(testTopic);
});

afterEach(async () => {
  // Clean up database
  await serverDB.delete(users);
});

describe('GenerationBatchModel', () => {
  describe('create', () => {
    it('should create a new generation batch', async () => {
      const result = await generationBatchModel.create(testBatch);

      expect(result.id).toBeDefined();
      expect(result).toMatchObject({
        ...testBatch,
        userId,
      });

      // Verify in database
      const dbBatch = await serverDB.query.generationBatches.findFirst({
        where: eq(generationBatches.id, result.id),
      });
      expect(dbBatch).toMatchObject({
        ...testBatch,
        userId,
      });
    });

    it('should automatically set userId when creating batch', async () => {
      // Create batch data without userId to test auto-assignment
      const batchWithoutUserId = {
        generationTopicId: 'test-topic-id',
        provider: 'test-provider',
        model: 'test-model',
        prompt: 'Test prompt for image generation',
        width: 1024,
        height: 1024,
        config: {
          prompt: 'Test prompt for image generation',
          imageUrls: ['image1.jpg', 'image2.jpg'],
          width: 1024,
          height: 1024,
        } as GenerationConfig,
      };

      const result = await generationBatchModel.create(batchWithoutUserId as NewGenerationBatch);

      expect(result.userId).toBe(userId);
    });
  });

  describe('findById', () => {
    it('should find a generation batch by id', async () => {
      const [createdBatch] = await serverDB
        .insert(generationBatches)
        .values({ ...testBatch, userId })
        .returning();

      const result = await generationBatchModel.findById(createdBatch.id);

      expect(result).toMatchObject({
        id: createdBatch.id,
        ...testBatch,
        userId,
      });
    });

    it('should return undefined for non-existent batch', async () => {
      const result = await generationBatchModel.findById('non-existent-id');
      expect(result).toBeUndefined();
    });

    it('should NOT find batches from other users', async () => {
      // Create batch for other user
      const [otherUserBatch] = await serverDB
        .insert(generationBatches)
        .values({ ...testBatch, userId: otherUserId })
        .returning();

      const result = await generationBatchModel.findById(otherUserBatch.id);
      expect(result).toBeUndefined();
    });
  });

  describe('findByTopicId', () => {
    it('should find batches by topic id', async () => {
      // Create multiple batches for the topic with explicit timestamps
      const oldDate = new Date('2024-01-01T10:00:00Z');
      const newDate = new Date('2024-01-02T10:00:00Z');

      const batch1 = { ...testBatch, prompt: 'First batch', userId, createdAt: oldDate };
      const batch2 = { ...testBatch, prompt: 'Second batch', userId, createdAt: newDate };

      await serverDB.insert(generationBatches).values([batch1, batch2]);

      const results = await generationBatchModel.findByTopicId(testTopic.id);

      expect(results).toHaveLength(2);
      expect(results[0].prompt).toBe('Second batch'); // Latest first (desc order)
      expect(results[1].prompt).toBe('First batch');
    });

    it('should only return batches for current user', async () => {
      // Create batches for both users
      await serverDB.insert(generationBatches).values([
        { ...testBatch, userId, prompt: 'User batch' },
        { ...testBatch, userId: otherUserId, prompt: 'Other user batch' },
      ]);

      const results = await generationBatchModel.findByTopicId(testTopic.id);

      expect(results).toHaveLength(1);
      expect(results[0].prompt).toBe('User batch');
    });

    it('should return empty array when no batches exist for topic', async () => {
      const results = await generationBatchModel.findByTopicId('non-existent-topic');
      expect(results).toHaveLength(0);
    });
  });

  describe('findByTopicIdWithGenerations', () => {
    it('should find batches with their generations', async () => {
      // Create batch
      const [createdBatch] = await serverDB
        .insert(generationBatches)
        .values({ ...testBatch, userId })
        .returning();

      // Create generations for the batch
      await serverDB.insert(generations).values([
        { ...testGeneration, generationBatchId: createdBatch.id },
        { ...testGeneration, id: 'gen2', generationBatchId: createdBatch.id },
      ]);

      const results = await generationBatchModel.findByTopicIdWithGenerations(testTopic.id);

      expect(results).toHaveLength(1);
      expect(results[0].generations).toHaveLength(2);
      // Generations are ordered by createdAt ASC, then by id ASC
      // Since both have same createdAt, 'gen2' comes before 'test-gen-id' alphabetically
      expect(results[0].generations[0].id).toBe('gen2');
    });

    it('should order generations by createdAt and id', async () => {
      const [createdBatch] = await serverDB
        .insert(generationBatches)
        .values({ ...testBatch, userId })
        .returning();

      // Create generations with different timestamps
      const oldDate = new Date('2024-01-01');
      const newDate = new Date('2024-01-02');

      await serverDB.insert(generations).values([
        {
          ...testGeneration,
          id: 'gen-new',
          generationBatchId: createdBatch.id,
          createdAt: newDate,
        },
        {
          ...testGeneration,
          id: 'gen-old',
          generationBatchId: createdBatch.id,
          createdAt: oldDate,
        },
      ]);

      const results = await generationBatchModel.findByTopicIdWithGenerations(testTopic.id);

      expect(results[0].generations[0].id).toBe('gen-old');
      expect(results[0].generations[1].id).toBe('gen-new');
    });

    it('should NOT include generations from other users', async () => {
      // Create batch for current user
      const [userBatch] = await serverDB
        .insert(generationBatches)
        .values({ ...testBatch, userId })
        .returning();

      // Create batch for other user
      const [otherBatch] = await serverDB
        .insert(generationBatches)
        .values({ ...testBatch, userId: otherUserId })
        .returning();

      // Create generations for both batches
      await serverDB.insert(generations).values([
        { ...testGeneration, generationBatchId: userBatch.id, userId },
        {
          ...testGeneration,
          id: 'other-gen',
          generationBatchId: otherBatch.id,
          userId: otherUserId,
        },
      ]);

      const results = await generationBatchModel.findByTopicIdWithGenerations(testTopic.id);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(userBatch.id);
    });
  });

  describe('queryGenerationBatchesByTopicIdWithGenerations', () => {
    it('should return transformed batches with generations', async () => {
      // Create batch
      const [createdBatch] = await serverDB
        .insert(generationBatches)
        .values({ ...testBatch, userId })
        .returning();

      // Create generation
      await serverDB
        .insert(generations)
        .values([{ ...testGeneration, generationBatchId: createdBatch.id }]);

      const results = await generationBatchModel.queryGenerationBatchesByTopicIdWithGenerations(
        testTopic.id,
      );

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        id: createdBatch.id,
        provider: testBatch.provider,
        model: testBatch.model,
        prompt: testBatch.prompt,
        width: testBatch.width,
        height: testBatch.height,
        generations: expect.any(Array),
      });

      // Verify FileService was called for config imageUrls
      expect(mockGetFullFileUrl).toHaveBeenCalledWith('image1.jpg');
      expect(mockGetFullFileUrl).toHaveBeenCalledWith('image2.jpg');

      // Verify GenerationModel.transformGeneration was called
      expect(mockTransformGeneration).toHaveBeenCalledTimes(1);
    });

    it('should transform config imageUrls through FileService', async () => {
      const [createdBatch] = await serverDB
        .insert(generationBatches)
        .values({
          ...testBatch,
          userId,
          config: { imageUrls: ['url1.jpg', 'url2.jpg'] },
        })
        .returning();

      const results = await generationBatchModel.queryGenerationBatchesByTopicIdWithGenerations(
        testTopic.id,
      );

      expect(results[0].config).toEqual({
        imageUrls: ['https://example.com/url1.jpg', 'https://example.com/url2.jpg'],
      });
    });

    it('should transform single config imageUrl through FileService', async () => {
      const [createdBatch] = await serverDB
        .insert(generationBatches)
        .values({
          ...testBatch,
          userId,
          config: { imageUrl: 'single-image.jpg', prompt: 'test prompt' },
        })
        .returning();

      const results = await generationBatchModel.queryGenerationBatchesByTopicIdWithGenerations(
        testTopic.id,
      );

      expect(results[0].config).toEqual({
        imageUrl: 'https://example.com/single-image.jpg',
        prompt: 'test prompt',
      });
    });

    it('should transform both imageUrl and imageUrls when both are present', async () => {
      const [createdBatch] = await serverDB
        .insert(generationBatches)
        .values({
          ...testBatch,
          userId,
          config: {
            imageUrl: 'single-image.jpg',
            imageUrls: ['url1.jpg', 'url2.jpg'],
            prompt: 'test prompt',
          },
        })
        .returning();

      const results = await generationBatchModel.queryGenerationBatchesByTopicIdWithGenerations(
        testTopic.id,
      );

      expect(results[0].config).toEqual({
        imageUrl: 'https://example.com/single-image.jpg',
        imageUrls: ['https://example.com/url1.jpg', 'https://example.com/url2.jpg'],
        prompt: 'test prompt',
      });
    });

    it('should handle config without imageUrls', async () => {
      const [createdBatch] = await serverDB
        .insert(generationBatches)
        .values({
          ...testBatch,
          userId,
          config: { otherField: 'value' },
        })
        .returning();

      const results = await generationBatchModel.queryGenerationBatchesByTopicIdWithGenerations(
        testTopic.id,
      );

      expect(results[0].config).toEqual({ otherField: 'value' });
      expect(mockGetFullFileUrl).not.toHaveBeenCalled();
    });

    it('should return empty array when no batches exist', async () => {
      const results =
        await generationBatchModel.queryGenerationBatchesByTopicIdWithGenerations(
          'non-existent-topic',
        );
      expect(results).toHaveLength(0);
    });

    it('should handle batches without generations', async () => {
      await serverDB.insert(generationBatches).values({ ...testBatch, userId });

      const results = await generationBatchModel.queryGenerationBatchesByTopicIdWithGenerations(
        testTopic.id,
      );

      expect(results).toHaveLength(1);
      expect(results[0].generations).toHaveLength(0);
    });
  });

  describe('delete', () => {
    it('should delete a generation batch and return batch data with thumbnail URLs', async () => {
      const [createdBatch] = await serverDB
        .insert(generationBatches)
        .values({ ...testBatch, userId })
        .returning();

      // Create generation with thumbnail URL
      await serverDB.insert(generations).values({
        ...testGeneration,
        generationBatchId: createdBatch.id,
        asset: {
          type: 'image',
          url: 'asset-url.jpg',
          thumbnailUrl: 'thumbnail-url.jpg',
          width: 1024,
          height: 1024,
        },
      });

      const result = await generationBatchModel.delete(createdBatch.id);

      // Verify return value structure
      expect(result).toBeDefined();
      expect(result!.deletedBatch).toMatchObject({
        id: createdBatch.id,
        ...testBatch,
        userId,
      });
      expect(result!.thumbnailUrls).toEqual(['thumbnail-url.jpg']);

      // Verify batch was actually deleted from database
      const deletedBatch = await serverDB.query.generationBatches.findFirst({
        where: eq(generationBatches.id, createdBatch.id),
      });
      expect(deletedBatch).toBeUndefined();
    });

    it('should collect multiple thumbnail URLs from multiple generations', async () => {
      const [createdBatch] = await serverDB
        .insert(generationBatches)
        .values({ ...testBatch, userId })
        .returning();

      // Create multiple generations with different thumbnail URLs
      await serverDB.insert(generations).values([
        {
          ...testGeneration,
          id: 'gen1',
          generationBatchId: createdBatch.id,
          asset: {
            type: 'image',
            url: 'asset1.jpg',
            thumbnailUrl: 'thumbnail1.jpg',
            width: 1024,
            height: 1024,
          },
        },
        {
          ...testGeneration,
          id: 'gen2',
          generationBatchId: createdBatch.id,
          asset: {
            type: 'image',
            url: 'asset2.jpg',
            thumbnailUrl: 'thumbnail2.jpg',
            width: 1024,
            height: 1024,
          },
        },
      ]);

      const result = await generationBatchModel.delete(createdBatch.id);

      expect(result).toBeDefined();
      expect(result!.thumbnailUrls).toHaveLength(2);
      expect(result!.thumbnailUrls).toContain('thumbnail1.jpg');
      expect(result!.thumbnailUrls).toContain('thumbnail2.jpg');
    });

    it('should return empty thumbnail URLs when no generations have thumbnails', async () => {
      const [createdBatch] = await serverDB
        .insert(generationBatches)
        .values({ ...testBatch, userId })
        .returning();

      const result = await generationBatchModel.delete(createdBatch.id);

      expect(result).toBeDefined();
      expect(result!.deletedBatch.id).toBe(createdBatch.id);
      expect(result!.thumbnailUrls).toEqual([]);
    });

    it('should return undefined when trying to delete non-existent batch', async () => {
      const result = await generationBatchModel.delete('non-existent-id');
      expect(result).toBeUndefined();
    });

    it('should return undefined when trying to delete batch from other user', async () => {
      // Create batch for other user
      const [otherUserBatch] = await serverDB
        .insert(generationBatches)
        .values({ ...testBatch, userId: otherUserId })
        .returning();

      // Try to delete using current user's model
      const result = await generationBatchModel.delete(otherUserBatch.id);
      expect(result).toBeUndefined();

      // Verify batch still exists
      const stillExists = await serverDB.query.generationBatches.findFirst({
        where: eq(generationBatches.id, otherUserBatch.id),
      });
      expect(stillExists).toBeDefined();
    });
  });

  describe('user isolation security tests', () => {
    it('should enforce user data isolation across all methods', async () => {
      // Create batches for both users with same topic
      const userBatch = { ...testBatch, userId };
      const otherUserBatch = { ...testBatch, userId: otherUserId };

      const [userBatchCreated] = await serverDB
        .insert(generationBatches)
        .values(userBatch)
        .returning();

      const [otherUserBatchCreated] = await serverDB
        .insert(generationBatches)
        .values(otherUserBatch)
        .returning();

      // Test findById isolation
      const foundUserBatch = await generationBatchModel.findById(userBatchCreated.id);
      const foundOtherBatch = await generationBatchModel.findById(otherUserBatchCreated.id);

      expect(foundUserBatch).toBeDefined();
      expect(foundOtherBatch).toBeUndefined(); // Should not find other user's batch

      // Test findByTopicId isolation
      const topicBatches = await generationBatchModel.findByTopicId(testTopic.id);
      expect(topicBatches).toHaveLength(1);
      expect(topicBatches[0].id).toBe(userBatchCreated.id);

      // Test delete isolation - should not affect other user's data
      await generationBatchModel.delete(otherUserBatchCreated.id);
      const otherUserBatchStillExists = await serverDB.query.generationBatches.findFirst({
        where: eq(generationBatches.id, otherUserBatchCreated.id),
      });
      expect(otherUserBatchStillExists).toBeDefined(); // Should not be deleted
    });
  });

  describe('External service integration', () => {
    it('should call FileService with correct parameters', async () => {
      const [createdBatch] = await serverDB
        .insert(generationBatches)
        .values({
          ...testBatch,
          userId,
          config: { imageUrls: ['test-image.jpg'] },
        })
        .returning();

      await generationBatchModel.queryGenerationBatchesByTopicIdWithGenerations(testTopic.id);

      expect(mockGetFullFileUrl).toHaveBeenCalledWith('test-image.jpg');
      expect(mockGetFullFileUrl).toHaveBeenCalledTimes(1);
    });

    it('should call GenerationModel.transformGeneration for each generation', async () => {
      const [createdBatch] = await serverDB
        .insert(generationBatches)
        .values({ ...testBatch, userId })
        .returning();

      // Create multiple generations
      await serverDB.insert(generations).values([
        { ...testGeneration, id: 'gen1', generationBatchId: createdBatch.id },
        { ...testGeneration, id: 'gen2', generationBatchId: createdBatch.id },
      ]);

      await generationBatchModel.queryGenerationBatchesByTopicIdWithGenerations(testTopic.id);

      expect(mockTransformGeneration).toHaveBeenCalledTimes(2);
    });

    it('should handle FileService errors gracefully', async () => {
      mockGetFullFileUrl.mockRejectedValue(new Error('FileService error'));

      const [createdBatch] = await serverDB
        .insert(generationBatches)
        .values({
          ...testBatch,
          userId,
          config: { imageUrls: ['failing-image.jpg'] },
        })
        .returning();

      await expect(
        generationBatchModel.queryGenerationBatchesByTopicIdWithGenerations(testTopic.id),
      ).rejects.toThrow('FileService error');
    });
  });
});
