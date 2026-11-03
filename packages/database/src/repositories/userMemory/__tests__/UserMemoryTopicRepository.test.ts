// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { messages } from '../../../schemas/message';
import { topics } from '../../../schemas/topic';
import { users } from '../../../schemas/user';
import type { LobeChatDatabase } from '../../../type';
import { UserMemoryTopicRepository } from '../UserMemoryTopicRepository';

const userId = 'user-memory-topic-test-user';
const topicId = 'test-topic-1';

let repo: UserMemoryTopicRepository;

const serverDB: LobeChatDatabase = await getTestDB();

beforeEach(async () => {
  // Clean up
  await serverDB.delete(messages);
  await serverDB.delete(topics);
  await serverDB.delete(users);

  // Create test user
  await serverDB.insert(users).values({ id: userId });

  // Create test topic
  await serverDB.insert(topics).values({ id: topicId, userId });

  // Initialize repo
  repo = new UserMemoryTopicRepository(serverDB, userId);
});

describe('UserMemoryTopicRepository', () => {
  describe('getUserMessagesQueryForTopic', () => {
    it('should return null when no user messages exist', async () => {
      const result = await repo.getUserMessagesQueryForTopic(topicId);
      expect(result).toBeNull();
    });

    it('should return null when only assistant messages exist', async () => {
      await serverDB.insert(messages).values([
        { id: 'msg-1', content: 'Hello!', role: 'assistant', topicId, userId },
        { id: 'msg-2', content: 'How can I help?', role: 'assistant', topicId, userId },
      ]);

      const result = await repo.getUserMessagesQueryForTopic(topicId);
      expect(result).toBeNull();
    });

    it('should return concatenated user message content', async () => {
      await serverDB.insert(messages).values([
        {
          id: 'msg-1',
          content: 'Hello',
          role: 'user',
          topicId,
          userId,
          createdAt: new Date('2024-01-01'),
        },
        {
          id: 'msg-2',
          content: 'Hi there!',
          role: 'assistant',
          topicId,
          userId,
          createdAt: new Date('2024-01-02'),
        },
        {
          id: 'msg-3',
          content: 'How are you?',
          role: 'user',
          topicId,
          userId,
          createdAt: new Date('2024-01-03'),
        },
      ]);

      const result = await repo.getUserMessagesQueryForTopic(topicId);
      expect(result).toBe('Hello\nHow are you?');
    });

    it('should order messages by createdAt', async () => {
      await serverDB.insert(messages).values([
        {
          id: 'msg-3',
          content: 'Third message',
          role: 'user',
          topicId,
          userId,
          createdAt: new Date('2024-01-03'),
        },
        {
          id: 'msg-1',
          content: 'First message',
          role: 'user',
          topicId,
          userId,
          createdAt: new Date('2024-01-01'),
        },
        {
          id: 'msg-2',
          content: 'Second message',
          role: 'user',
          topicId,
          userId,
          createdAt: new Date('2024-01-02'),
        },
      ]);

      const result = await repo.getUserMessagesQueryForTopic(topicId);
      expect(result).toBe('First message\nSecond message\nThird message');
    });

    it('should truncate result to 7000 characters', async () => {
      // Create a message with content longer than 7000 chars
      const longContent = 'A'.repeat(8000);
      await serverDB
        .insert(messages)
        .values([{ id: 'msg-1', content: longContent, role: 'user', topicId, userId }]);

      const result = await repo.getUserMessagesQueryForTopic(topicId);
      expect(result).toHaveLength(7000);
      expect(result).toBe('A'.repeat(7000));
    });

    it('should truncate concatenated content to 7000 characters', async () => {
      // Create multiple messages that together exceed 7000 chars
      const content1 = 'B'.repeat(4000);
      const content2 = 'C'.repeat(4000);
      await serverDB.insert(messages).values([
        {
          id: 'msg-1',
          content: content1,
          role: 'user',
          topicId,
          userId,
          createdAt: new Date('2024-01-01'),
        },
        {
          id: 'msg-2',
          content: content2,
          role: 'user',
          topicId,
          userId,
          createdAt: new Date('2024-01-02'),
        },
      ]);

      const result = await repo.getUserMessagesQueryForTopic(topicId);
      expect(result).toHaveLength(7000);
      // Should be content1 + newline + first part of content2
      expect(result!.startsWith('B'.repeat(4000))).toBe(true);
    });

    it('should filter messages by topic', async () => {
      const otherTopicId = 'other-topic';
      await serverDB.insert(topics).values({ id: otherTopicId, userId });

      await serverDB.insert(messages).values([
        { id: 'msg-1', content: 'Topic 1 message', role: 'user', topicId, userId },
        {
          id: 'msg-2',
          content: 'Other topic message',
          role: 'user',
          topicId: otherTopicId,
          userId,
        },
      ]);

      const result = await repo.getUserMessagesQueryForTopic(topicId);
      expect(result).toBe('Topic 1 message');
    });

    it('should filter messages by user', async () => {
      const otherUserId = 'other-user';
      await serverDB.insert(users).values({ id: otherUserId });

      await serverDB.insert(messages).values([
        { id: 'msg-1', content: 'My message', role: 'user', topicId, userId },
        { id: 'msg-2', content: 'Other user message', role: 'user', topicId, userId: otherUserId },
      ]);

      const result = await repo.getUserMessagesQueryForTopic(topicId);
      expect(result).toBe('My message');
    });

    it('should skip messages with null or empty content', async () => {
      await serverDB.insert(messages).values([
        { id: 'msg-1', content: 'Valid message', role: 'user', topicId, userId },
        { id: 'msg-2', content: null, role: 'user', topicId, userId },
        { id: 'msg-3', content: '', role: 'user', topicId, userId },
        { id: 'msg-4', content: 'Another valid', role: 'user', topicId, userId },
      ]);

      const result = await repo.getUserMessagesQueryForTopic(topicId);
      expect(result).toBe('Valid message\nAnother valid');
    });

    it('should return null when all user messages have empty content', async () => {
      await serverDB.insert(messages).values([
        { id: 'msg-1', content: null, role: 'user', topicId, userId },
        { id: 'msg-2', content: '', role: 'user', topicId, userId },
      ]);

      const result = await repo.getUserMessagesQueryForTopic(topicId);
      expect(result).toBeNull();
    });
  });
});
