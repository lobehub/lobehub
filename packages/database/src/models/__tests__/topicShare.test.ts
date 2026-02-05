// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, sessions, topics, topicShares, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TopicShareModel } from '../topicShare';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'topic-share-test-user-id';
const userId2 = 'topic-share-test-user-id-2';
const sessionId = 'topic-share-test-session';
const topicId = 'topic-share-test-topic';
const topicId2 = 'topic-share-test-topic-2';
const agentId = 'topic-share-test-agent';

const topicShareModel = new TopicShareModel(serverDB, userId);
const topicShareModel2 = new TopicShareModel(serverDB, userId2);

describe('TopicShareModel', () => {
  beforeEach(async () => {
    await serverDB.delete(users);

    // Create test users, sessions, agents and topics
    await serverDB.transaction(async (tx) => {
      await tx.insert(users).values([{ id: userId }, { id: userId2 }]);
      await tx.insert(sessions).values([
        { id: sessionId, userId },
        { id: `${sessionId}-2`, userId: userId2 },
      ]);
      await tx.insert(agents).values([{ id: agentId, userId }]);
      await tx.insert(topics).values([
        { id: topicId, sessionId, userId, agentId, title: 'Test Topic' },
        { id: topicId2, sessionId, userId, title: 'Test Topic 2' },
        { id: 'user2-topic', sessionId: `${sessionId}-2`, userId: userId2, title: 'User 2 Topic' },
      ]);
    });
  });

  afterEach(async () => {
    await serverDB.delete(topicShares);
    await serverDB.delete(topics);
    await serverDB.delete(agents);
    await serverDB.delete(sessions);
    await serverDB.delete(users);
  });

  describe('create', () => {
    it('should create a share for a topic with default visibility', async () => {
      const result = await topicShareModel.create(topicId);

      expect(result).toBeDefined();
      expect(result.topicId).toBe(topicId);
      expect(result.userId).toBe(userId);
      expect(result.visibility).toBe('private');
      expect(result.id).toBeDefined();
    });

    it('should create a share with link visibility', async () => {
      const result = await topicShareModel.create(topicId, 'link');

      expect(result.visibility).toBe('link');
    });

    it('should throw error when topic does not exist', async () => {
      await expect(topicShareModel.create('non-existent-topic')).rejects.toThrow(
        'Topic not found or not owned by user',
      );
    });

    it('should throw error when trying to share another users topic', async () => {
      await expect(topicShareModel.create('user2-topic')).rejects.toThrow(
        'Topic not found or not owned by user',
      );
    });
  });

  describe('updateVisibility', () => {
    it('should update share visibility', async () => {
      await topicShareModel.create(topicId, 'private');

      const result = await topicShareModel.updateVisibility(topicId, 'link');

      expect(result).toBeDefined();
      expect(result!.visibility).toBe('link');
    });

    it('should return null when share does not exist', async () => {
      const result = await topicShareModel.updateVisibility('non-existent-topic', 'link');

      expect(result).toBeNull();
    });

    it('should not update other users share', async () => {
      // Create share for user2
      await topicShareModel2.create('user2-topic', 'private');

      // User1 tries to update user2's share
      const result = await topicShareModel.updateVisibility('user2-topic', 'link');

      expect(result).toBeNull();

      // Verify user2's share is unchanged
      const share = await topicShareModel2.getByTopicId('user2-topic');
      expect(share!.visibility).toBe('private');
    });
  });

  describe('deleteByTopicId', () => {
    it('should delete share by topic id', async () => {
      await topicShareModel.create(topicId);

      await topicShareModel.deleteByTopicId(topicId);

      const share = await topicShareModel.getByTopicId(topicId);
      expect(share).toBeNull();
    });

    it('should not delete other users share', async () => {
      await topicShareModel2.create('user2-topic');

      // User1 tries to delete user2's share
      await topicShareModel.deleteByTopicId('user2-topic');

      // User2's share should still exist
      const share = await topicShareModel2.getByTopicId('user2-topic');
      expect(share).not.toBeNull();
    });
  });

  describe('getByTopicId', () => {
    it('should get share info by topic id', async () => {
      const created = await topicShareModel.create(topicId, 'link');

      const result = await topicShareModel.getByTopicId(topicId);

      expect(result).toBeDefined();
      expect(result!.id).toBe(created.id);
      expect(result!.topicId).toBe(topicId);
      expect(result!.visibility).toBe('link');
    });

    it('should return null when share does not exist', async () => {
      const result = await topicShareModel.getByTopicId(topicId);

      expect(result).toBeNull();
    });

    it('should not return other users share', async () => {
      await topicShareModel2.create('user2-topic');

      const result = await topicShareModel.getByTopicId('user2-topic');

      expect(result).toBeNull();
    });
  });

  describe('findByShareId (static)', () => {
    it('should find share by share id with topic and agent info', async () => {
      const created = await topicShareModel.create(topicId, 'link');

      const result = await TopicShareModel.findByShareId(serverDB, created.id);

      expect(result).toBeDefined();
      expect(result!.shareId).toBe(created.id);
      expect(result!.topicId).toBe(topicId);
      expect(result!.title).toBe('Test Topic');
      expect(result!.ownerId).toBe(userId);
      expect(result!.visibility).toBe('link');
      expect(result!.agentId).toBe(agentId);
    });

    it('should return null when share does not exist', async () => {
      const result = await TopicShareModel.findByShareId(serverDB, 'non-existent-share');

      expect(result).toBeNull();
    });

    it('should return share without agent info when topic has no agent', async () => {
      const created = await topicShareModel.create(topicId2);

      const result = await TopicShareModel.findByShareId(serverDB, created.id);

      expect(result).toBeDefined();
      expect(result!.agentId).toBeNull();
    });
  });

  describe('incrementPageViewCount (static)', () => {
    it('should increment page view count', async () => {
      const created = await topicShareModel.create(topicId);

      // Initial page view count is 0
      const initial = await serverDB.query.topicShares.findFirst({
        where: (t, { eq }) => eq(t.id, created.id),
      });
      expect(initial!.pageViewCount).toBe(0);

      // Increment page view count
      await TopicShareModel.incrementPageViewCount(serverDB, created.id);

      const after = await serverDB.query.topicShares.findFirst({
        where: (t, { eq }) => eq(t.id, created.id),
      });
      expect(after!.pageViewCount).toBe(1);
    });

    it('should increment page view count multiple times', async () => {
      const created = await topicShareModel.create(topicId);

      await TopicShareModel.incrementPageViewCount(serverDB, created.id);
      await TopicShareModel.incrementPageViewCount(serverDB, created.id);
      await TopicShareModel.incrementPageViewCount(serverDB, created.id);

      const result = await serverDB.query.topicShares.findFirst({
        where: (t, { eq }) => eq(t.id, created.id),
      });
      expect(result!.pageViewCount).toBe(3);
    });
  });

  describe('findByShareIdWithAccessCheck (static)', () => {
    it('should return share for owner regardless of visibility', async () => {
      const created = await topicShareModel.create(topicId, 'private');

      const result = await TopicShareModel.findByShareIdWithAccessCheck(
        serverDB,
        created.id,
        userId,
      );

      expect(result).toBeDefined();
      expect(result.shareId).toBe(created.id);
    });

    it('should return share for anonymous user when visibility is link', async () => {
      const created = await topicShareModel.create(topicId, 'link');

      const result = await TopicShareModel.findByShareIdWithAccessCheck(
        serverDB,
        created.id,
        undefined,
      );

      expect(result).toBeDefined();
      expect(result.shareId).toBe(created.id);
    });

    it('should throw NOT_FOUND when share does not exist', async () => {
      await expect(
        TopicShareModel.findByShareIdWithAccessCheck(serverDB, 'non-existent', userId),
      ).rejects.toThrow(TRPCError);

      try {
        await TopicShareModel.findByShareIdWithAccessCheck(serverDB, 'non-existent', userId);
      } catch (error) {
        expect((error as TRPCError).code).toBe('NOT_FOUND');
      }
    });

    it('should throw FORBIDDEN when visibility is private and user is not owner', async () => {
      const created = await topicShareModel.create(topicId, 'private');

      await expect(
        TopicShareModel.findByShareIdWithAccessCheck(serverDB, created.id, userId2),
      ).rejects.toThrow(TRPCError);

      try {
        await TopicShareModel.findByShareIdWithAccessCheck(serverDB, created.id, userId2);
      } catch (error) {
        expect((error as TRPCError).code).toBe('FORBIDDEN');
      }
    });

    it('should throw FORBIDDEN when visibility is private and user is anonymous', async () => {
      const created = await topicShareModel.create(topicId, 'private');

      await expect(
        TopicShareModel.findByShareIdWithAccessCheck(serverDB, created.id, undefined),
      ).rejects.toThrow(TRPCError);

      try {
        await TopicShareModel.findByShareIdWithAccessCheck(serverDB, created.id, undefined);
      } catch (error) {
        expect((error as TRPCError).code).toBe('FORBIDDEN');
      }
    });
  });

  describe('user isolation', () => {
    it('should enforce user data isolation for all operations', async () => {
      // User1 creates a share
      await topicShareModel.create(topicId, 'private');

      // User2 creates a share
      await topicShareModel2.create('user2-topic', 'link');

      // User1 cannot access user2's share via getByTopicId
      const user1Access = await topicShareModel.getByTopicId('user2-topic');
      expect(user1Access).toBeNull();

      // User2 cannot access user1's share via getByTopicId
      const user2Access = await topicShareModel2.getByTopicId(topicId);
      expect(user2Access).toBeNull();

      // User1 cannot update user2's share
      const updateResult = await topicShareModel.updateVisibility('user2-topic', 'private');
      expect(updateResult).toBeNull();

      // User1 cannot delete user2's share
      await topicShareModel.deleteByTopicId('user2-topic');
      const stillExists = await topicShareModel2.getByTopicId('user2-topic');
      expect(stillExists).not.toBeNull();
    });
  });
});
