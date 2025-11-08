// @vitest-environment node
import { ImageGenerationTopic } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generationBatches, generationTopics, generations, users } from '../../schemas';
import { LobeChatDatabase } from '../../type';
import { GenerationTopicModel } from '../generationTopic';
import { getTestDB } from './_util';

// Mock FileService
const mockGetFullFileUrl = vi.fn();
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    getFullFileUrl: mockGetFullFileUrl,
  })),
}));

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'generation-topic-test-user';
const otherUserId = 'other-user';
const generationTopicModel = new GenerationTopicModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);

  // Reset mocks before each test
  vi.clearAllMocks();
  mockGetFullFileUrl.mockImplementation((url: string) => `https://example.com/${url}`);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('GenerationTopicModel', () => {
  describe('create', () => {
    it('should create a new generation topic', async () => {
      const title = 'Test Generation Topic';

      const result = await generationTopicModel.create(title);

      expect(result.id).toBeDefined();
      expect(result.title).toBe(title);
      expect(result.userId).toBe(userId);
      expect(result.coverUrl).toBeNull();
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);

      // Verify it's saved in database
      const topic = await serverDB.query.generationTopics.findFirst({
        where: eq(generationTopics.id, result.id),
      });
      expect(topic).toMatchObject({ title, userId });
    });

    it('should create a topic with empty title', async () => {
      const result = await generationTopicModel.create('');

      expect(result.id).toBeDefined();
      expect(result.title).toBe('');
      expect(result.userId).toBe(userId);
    });
  });

  describe('queryAll', () => {
    it('should return all topics for the user ordered by updatedAt desc', async () => {
      // Create test data with different timestamps
      const now = new Date();
      const earlier = new Date(now.getTime() - 60000); // 1 minute earlier
      const earliest = new Date(now.getTime() - 120000); // 2 minutes earlier

      await serverDB.insert(generationTopics).values([
        {
          id: 'topic1',
          userId,
          title: 'Topic 1',
          updatedAt: earliest,
        },
        {
          id: 'topic2',
          userId,
          title: 'Topic 2',
          updatedAt: now,
        },
        {
          id: 'topic3',
          userId,
          title: 'Topic 3',
          updatedAt: earlier,
        },
        {
          id: 'topic4',
          userId: otherUserId,
          title: 'Other User Topic',
          updatedAt: now,
        },
      ]);

      const result = await generationTopicModel.queryAll();

      // Should return only topics for current user, ordered by updatedAt desc
      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('topic2'); // most recent
      expect(result[1].id).toBe('topic3'); // middle
      expect(result[2].id).toBe('topic1'); // oldest
    });

    it('should process cover URLs through FileService', async () => {
      await serverDB.insert(generationTopics).values([
        {
          id: 'topic1',
          userId,
          title: 'Topic with cover',
          coverUrl: 'cover-image-key',
        },
        {
          id: 'topic2',
          userId,
          title: 'Topic without cover',
          coverUrl: null,
        },
      ]);

      const result = await generationTopicModel.queryAll();

      expect(result).toHaveLength(2);
      expect(result[0].coverUrl).toBe('https://example.com/cover-image-key');
      expect(result[1].coverUrl).toBeNull();

      // Verify FileService was called for the topic with coverUrl
      expect(mockGetFullFileUrl).toHaveBeenCalledWith('cover-image-key');
      expect(mockGetFullFileUrl).toHaveBeenCalledTimes(1);
    });

    it('should return empty array if no topics exist', async () => {
      const result = await generationTopicModel.queryAll();
      expect(result).toHaveLength(0);
    });
  });

  describe('update', () => {
    it('should update a generation topic', async () => {
      // Create a test topic
      const { id } = await generationTopicModel.create('Original Title');

      const updateData: Partial<ImageGenerationTopic> = {
        title: 'Updated Title',
        coverUrl: 'new-cover-key',
      };

      const result = await generationTopicModel.update(id, updateData);

      expect(result).toBeDefined();
      expect(result!.id).toBe(id);
      expect(result!.title).toBe('Updated Title');
      expect(result!.coverUrl).toBe('new-cover-key');
      expect(result!.updatedAt).toBeInstanceOf(Date);

      // Verify in database
      const updatedTopic = await serverDB.query.generationTopics.findFirst({
        where: eq(generationTopics.id, id),
      });
      expect(updatedTopic).toMatchObject(updateData);
    });

    it('should not update topics of other users', async () => {
      // Create a topic for another user
      const [otherUserTopic] = await serverDB
        .insert(generationTopics)
        .values({ id: 'other-topic', userId: otherUserId, title: 'Other User Topic' })
        .returning();

      const updateData: Partial<ImageGenerationTopic> = {
        title: 'Hacked Title',
      };

      // Attempt to update should not affect other user's topic
      const result = await generationTopicModel.update(otherUserTopic.id, updateData);

      // Should return undefined or empty result because of user permission check
      expect(result).toBeUndefined();

      // Verify the topic remains unchanged in the database
      const unchangedTopic = await serverDB.query.generationTopics.findFirst({
        where: eq(generationTopics.id, otherUserTopic.id),
      });
      expect(unchangedTopic?.title).toBe('Other User Topic');
    });

    it('should update only specified fields', async () => {
      const { id } = await generationTopicModel.create('Original Title');

      // Update only title
      const result = await generationTopicModel.update(id, { title: 'Only Title Updated' });

      expect(result).toBeDefined();
      expect(result!.title).toBe('Only Title Updated');
      expect(result!.coverUrl).toBeNull(); // Should remain unchanged
    });
  });

  describe('delete', () => {
    it('should delete a generation topic', async () => {
      const { id } = await generationTopicModel.create('Topic to Delete');

      const result = await generationTopicModel.delete(id);

      expect(result).toBeDefined();
      const deleteResult = result!;
      expect(deleteResult.deletedTopic.id).toBe(id);
      expect(deleteResult.deletedTopic.title).toBe('Topic to Delete');
      expect(deleteResult.filesToDelete).toEqual([]);

      // Verify it's deleted from database
      const deletedTopic = await serverDB.query.generationTopics.findFirst({
        where: eq(generationTopics.id, id),
      });
      expect(deletedTopic).toBeUndefined();
    });

    it('should not delete topics of other users', async () => {
      // Create a topic for another user
      const [otherUserTopic] = await serverDB
        .insert(generationTopics)
        .values({ id: 'other-topic', userId: otherUserId, title: 'Other User Topic' })
        .returning();

      // Attempt to delete should not affect other user's topic
      const result = await generationTopicModel.delete(otherUserTopic.id);

      // Should return undefined because of user permission check
      expect(result).toBeUndefined();

      // The topic should still exist in the database
      const stillExistsTopic = await serverDB.query.generationTopics.findFirst({
        where: eq(generationTopics.id, otherUserTopic.id),
      });
      expect(stillExistsTopic).toBeDefined();
      expect(stillExistsTopic?.title).toBe('Other User Topic');
    });

    it('should return deleted topic data', async () => {
      const { id } = await generationTopicModel.create('Topic with Data');

      // Add some data to the topic
      await generationTopicModel.update(id, {
        title: 'Updated Topic',
        coverUrl: 'cover-key',
      });

      const result = await generationTopicModel.delete(id);

      expect(result).toBeDefined();
      const deleteResult = result!;
      expect(deleteResult.deletedTopic).toMatchObject({
        id,
        title: 'Updated Topic',
        coverUrl: 'cover-key',
        userId,
      });
      expect(deleteResult.filesToDelete).toContain('cover-key');
    });

    it('should return undefined when trying to delete non-existent topic', async () => {
      const nonExistentId = 'non-existent-topic-id';

      const result = await generationTopicModel.delete(nonExistentId);

      // Should return undefined because topic doesn't exist
      expect(result).toBeUndefined();
    });

    it('should return undefined when trying to delete topic with invalid format id', async () => {
      const invalidId = 'invalid-format-id';

      const result = await generationTopicModel.delete(invalidId);

      // Should return undefined because topic doesn't exist with this invalid ID
      expect(result).toBeUndefined();
    });

    it('should collect file URLs from batches and generations when deleting topic with data', async () => {
      // Create a topic with cover image
      const { id: topicId } = await generationTopicModel.create(
        'Topic with batches and generations',
      );
      await generationTopicModel.update(topicId, { coverUrl: 'topic-cover.jpg' });

      // Create a generation batch associated with this topic
      const [batch] = await serverDB
        .insert(generationBatches)
        .values({
          userId,
          generationTopicId: topicId,
          provider: 'test-provider',
          model: 'test-model',
          prompt: 'Test generation prompt',
          width: 1024,
          height: 1024,
        })
        .returning();

      // Create generations with asset data containing thumbnail URLs
      await serverDB.insert(generations).values([
        {
          userId,
          generationBatchId: batch.id,
          asyncTaskId: null,
          fileId: null,
          seed: 12345,
          asset: {
            type: 'image',
            thumbnailUrl: 'thumbnail1.jpg',
            originalUrl: 'original1.jpg',
            width: 1024,
            height: 1024,
          },
        },
        {
          userId,
          generationBatchId: batch.id,
          asyncTaskId: null,
          fileId: null,
          seed: 12346,
          asset: {
            type: 'image',
            thumbnailUrl: 'thumbnail2.jpg',
            originalUrl: 'original2.jpg',
            width: 1024,
            height: 1024,
          },
        },
      ]);

      // Now delete the topic - this should collect all file URLs from cover + generations
      const result = await generationTopicModel.delete(topicId);

      expect(result).toBeDefined();
      const deleteResult = result!;
      expect(deleteResult.deletedTopic.id).toBe(topicId);

      // Should collect cover URL and thumbnail URLs from generations (lines 111-117)
      expect(deleteResult.filesToDelete).toContain('topic-cover.jpg');
      expect(deleteResult.filesToDelete).toContain('thumbnail1.jpg');
      expect(deleteResult.filesToDelete).toContain('thumbnail2.jpg');
      expect(deleteResult.filesToDelete).toHaveLength(3);

      // Verify topic is actually deleted from database
      const deletedTopic = await serverDB.query.generationTopics.findFirst({
        where: eq(generationTopics.id, topicId),
      });
      expect(deletedTopic).toBeUndefined();
    });
  });

  describe('user isolation', () => {
    it('should only operate on topics belonging to the user', async () => {
      // Create topics for different users
      await serverDB.insert(generationTopics).values([
        { id: 'user1-topic1', userId, title: 'User 1 Topic 1' },
        { id: 'user1-topic2', userId, title: 'User 1 Topic 2' },
        { id: 'user2-topic1', userId: otherUserId, title: 'User 2 Topic 1' },
      ]);

      const result = await generationTopicModel.queryAll();

      // Should only return topics for the current user
      expect(result).toHaveLength(2);
      expect(result.every((topic) => topic.userId === userId)).toBe(true);
      expect(result.some((topic) => topic.title === 'User 2 Topic 1')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle topics with null titles', async () => {
      await serverDB.insert(generationTopics).values({
        id: 'null-title-topic',
        userId,
        title: null,
      });

      const result = await generationTopicModel.queryAll();

      expect(result).toHaveLength(1);
      expect(result[0].title).toBeNull();
    });

    it('should handle topics with null coverUrl', async () => {
      const { id } = await generationTopicModel.create('Topic');

      const result = await generationTopicModel.update(id, { coverUrl: null });

      expect(result).toBeDefined();
      expect(result!.coverUrl).toBeNull();
    });

    it('should return undefined when updating non-existent topic', async () => {
      const nonExistentId = 'non-existent-topic';

      const updateResult = await generationTopicModel.update(nonExistentId, { title: 'New Title' });

      expect(updateResult).toBeUndefined();
    });
  });
});
