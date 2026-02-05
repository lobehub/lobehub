import { ThreadStatus, ThreadType } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { sessions, threads, topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ThreadModel } from '../thread';

const userId = 'thread-user-test';
const otherUserId = 'other-user-test';
const sessionId = 'thread-session';
const topicId = 'thread-topic';

const serverDB: LobeChatDatabase = await getTestDB();
const threadModel = new ThreadModel(serverDB, userId);

describe('ThreadModel', () => {
  beforeEach(async () => {
    await serverDB.delete(users);

    // Create test users, session and topic
    await serverDB.transaction(async (tx) => {
      await tx.insert(users).values([{ id: userId }, { id: otherUserId }]);
      await tx.insert(sessions).values({ id: sessionId, userId });
      await tx.insert(topics).values({ id: topicId, userId, sessionId });
    });
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  describe('create', () => {
    it('should create a new thread', async () => {
      const result = await threadModel.create({
        topicId,
        type: ThreadType.Standalone,
        sourceMessageId: 'msg-1',
      });

      expect(result).toBeDefined();
      expect(result.topicId).toBe(topicId);
      expect(result.type).toBe(ThreadType.Standalone);
      expect(result.status).toBe(ThreadStatus.Active);
      expect(result.sourceMessageId).toBe('msg-1');
    });

    it('should create a thread with title', async () => {
      const result = await threadModel.create({
        topicId,
        type: ThreadType.Continuation,
        title: 'Test Thread',
      });

      expect(result.title).toBe('Test Thread');
      expect(result.type).toBe(ThreadType.Continuation);
    });
  });

  describe('query', () => {
    it('should return all threads for the user', async () => {
      // Create test threads
      await serverDB.insert(threads).values([
        {
          id: 'thread-1',
          topicId,
          type: ThreadType.Standalone,
          status: ThreadStatus.Active,
          userId,
          updatedAt: new Date('2024-01-01'),
        },
        {
          id: 'thread-2',
          topicId,
          type: ThreadType.Continuation,
          status: ThreadStatus.Active,
          userId,
          updatedAt: new Date('2024-01-02'),
        },
      ]);

      const result = await threadModel.query();

      expect(result).toHaveLength(2);
      // Should be ordered by updatedAt desc
      expect(result[0].id).toBe('thread-2');
      expect(result[1].id).toBe('thread-1');
    });

    it('should only return threads for the current user', async () => {
      await serverDB.transaction(async (tx) => {
        await tx.insert(topics).values({ id: 'other-topic', userId: otherUserId });
        await tx.insert(threads).values([
          {
            id: 'thread-1',
            topicId,
            type: ThreadType.Standalone,
            status: ThreadStatus.Active,
            userId,
          },
          {
            id: 'thread-2',
            topicId: 'other-topic',
            type: ThreadType.Standalone,
            status: ThreadStatus.Active,
            userId: otherUserId,
          },
        ]);
      });

      const result = await threadModel.query();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('thread-1');
    });
  });

  describe('queryByTopicId', () => {
    it('should return threads for a specific topic', async () => {
      await serverDB.transaction(async (tx) => {
        await tx.insert(topics).values({ id: 'another-topic', userId, sessionId });
        await tx.insert(threads).values([
          {
            id: 'thread-1',
            topicId,
            type: ThreadType.Standalone,
            status: ThreadStatus.Active,
            userId,
            updatedAt: new Date('2024-01-01'),
          },
          {
            id: 'thread-2',
            topicId: 'another-topic',
            type: ThreadType.Standalone,
            status: ThreadStatus.Active,
            userId,
            updatedAt: new Date('2024-01-02'),
          },
        ]);
      });

      const result = await threadModel.queryByTopicId(topicId);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('thread-1');
    });

    it('should return empty array when no threads exist for the topic', async () => {
      const result = await threadModel.queryByTopicId('non-existent-topic');

      expect(result).toHaveLength(0);
    });
  });

  describe('findById', () => {
    it('should return a thread by id', async () => {
      await serverDB.insert(threads).values({
        id: 'thread-1',
        topicId,
        type: ThreadType.Standalone,
        status: ThreadStatus.Active,
        userId,
        title: 'Test Thread',
      });

      const result = await threadModel.findById('thread-1');

      expect(result).toBeDefined();
      expect(result?.id).toBe('thread-1');
      expect(result?.title).toBe('Test Thread');
    });

    it('should return undefined for non-existent thread', async () => {
      const result = await threadModel.findById('non-existent');

      expect(result).toBeUndefined();
    });

    it('should not return thread belonging to another user', async () => {
      await serverDB.transaction(async (tx) => {
        await tx.insert(topics).values({ id: 'other-topic', userId: otherUserId });
        await tx.insert(threads).values({
          id: 'thread-other',
          topicId: 'other-topic',
          type: ThreadType.Standalone,
          status: ThreadStatus.Active,
          userId: otherUserId,
        });
      });

      const result = await threadModel.findById('thread-other');

      expect(result).toBeUndefined();
    });
  });

  describe('update', () => {
    it('should update a thread', async () => {
      await serverDB.insert(threads).values({
        id: 'thread-1',
        topicId,
        type: ThreadType.Standalone,
        status: ThreadStatus.Active,
        userId,
        title: 'Original Title',
      });

      await threadModel.update('thread-1', {
        title: 'Updated Title',
        status: ThreadStatus.Completed,
      });

      const updated = await serverDB.query.threads.findFirst({
        where: eq(threads.id, 'thread-1'),
      });

      expect(updated?.title).toBe('Updated Title');
      expect(updated?.status).toBe(ThreadStatus.Completed);
    });

    it('should not update thread belonging to another user', async () => {
      await serverDB.transaction(async (tx) => {
        await tx.insert(topics).values({ id: 'other-topic', userId: otherUserId });
        await tx.insert(threads).values({
          id: 'thread-other',
          topicId: 'other-topic',
          type: ThreadType.Standalone,
          status: ThreadStatus.Active,
          userId: otherUserId,
          title: 'Original Title',
        });
      });

      await threadModel.update('thread-other', { title: 'Hacked Title' });

      const unchanged = await serverDB.query.threads.findFirst({
        where: eq(threads.id, 'thread-other'),
      });

      expect(unchanged?.title).toBe('Original Title');
    });
  });

  describe('delete', () => {
    it('should delete a thread', async () => {
      await serverDB.insert(threads).values({
        id: 'thread-1',
        topicId,
        type: ThreadType.Standalone,
        status: ThreadStatus.Active,
        userId,
      });

      await threadModel.delete('thread-1');

      const deleted = await serverDB.query.threads.findFirst({
        where: eq(threads.id, 'thread-1'),
      });

      expect(deleted).toBeUndefined();
    });

    it('should not delete thread belonging to another user', async () => {
      await serverDB.transaction(async (tx) => {
        await tx.insert(topics).values({ id: 'other-topic', userId: otherUserId });
        await tx.insert(threads).values({
          id: 'thread-other',
          topicId: 'other-topic',
          type: ThreadType.Standalone,
          status: ThreadStatus.Active,
          userId: otherUserId,
        });
      });

      await threadModel.delete('thread-other');

      const stillExists = await serverDB.query.threads.findFirst({
        where: eq(threads.id, 'thread-other'),
      });

      expect(stillExists).toBeDefined();
    });
  });

  describe('deleteAll', () => {
    it('should delete all threads for the current user', async () => {
      await serverDB.transaction(async (tx) => {
        await tx.insert(topics).values({ id: 'other-topic', userId: otherUserId });
        await tx.insert(threads).values([
          {
            id: 'thread-1',
            topicId,
            type: ThreadType.Standalone,
            status: ThreadStatus.Active,
            userId,
          },
          {
            id: 'thread-2',
            topicId,
            type: ThreadType.Continuation,
            status: ThreadStatus.Active,
            userId,
          },
          {
            id: 'thread-3',
            topicId: 'other-topic',
            type: ThreadType.Standalone,
            status: ThreadStatus.Active,
            userId: otherUserId,
          },
        ]);
      });

      await threadModel.deleteAll();

      const userThreads = await serverDB.select().from(threads).where(eq(threads.userId, userId));
      const otherUserThreads = await serverDB
        .select()
        .from(threads)
        .where(eq(threads.userId, otherUserId));

      expect(userThreads).toHaveLength(0);
      expect(otherUserThreads).toHaveLength(1);
    });
  });
});
