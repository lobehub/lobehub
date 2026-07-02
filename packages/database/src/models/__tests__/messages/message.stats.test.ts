import dayjs from 'dayjs';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { uuid } from '@/utils/uuid';

import { getTestDB } from '../../../core/getTestDB';
import { agents, embeddings, files, messages, sessions, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';
import { codeEmbedding } from '../fixtures/embedding';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'message-stats-test';
const otherUserId = 'message-stats-test-other';
const messageModel = new MessageModel(serverDB, userId);
const embeddingsId = uuid();

beforeEach(async () => {
  // Clear tables before each test case
  await serverDB.transaction(async (trx) => {
    await trx.delete(users).where(eq(users.id, userId));
    await trx.delete(users).where(eq(users.id, otherUserId));
    await trx.insert(users).values([{ id: userId }, { id: otherUserId }]);

    await trx.insert(sessions).values([{ id: '1', userId }]);
    await trx.insert(files).values({
      id: 'f1',
      userId,
      url: 'abc',
      name: 'file-1',
      fileType: 'image/png',
      size: 1000,
    });

    await trx.insert(embeddings).values({
      id: embeddingsId,
      embeddings: codeEmbedding,
      userId,
    });
  });
});

afterEach(async () => {
  // Clear tables after each test case
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
});

describe('MessageModel Statistics Tests', () => {
  describe('count', () => {
    it('should return the count of messages belonging to the user', async () => {
      // Create test data
      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'user', content: 'message 1' },
        { id: '2', userId, role: 'user', content: 'message 2' },
        { id: '3', userId: otherUserId, role: 'user', content: 'message 3' },
      ]);

      // Call count method
      const result = await messageModel.count();

      // Assert result
      expect(result).toBe(2);
    });

    describe('count with date filters', () => {
      beforeEach(async () => {
        // Create test data with messages on different dates
        await serverDB.insert(messages).values([
          {
            id: 'date1',
            userId,
            role: 'user',
            content: 'message 1',
            createdAt: new Date('2023-01-15'),
          },
          {
            id: 'date2',
            userId,
            role: 'user',
            content: 'message 2',
            createdAt: new Date('2023-02-15'),
          },
          {
            id: 'date3',
            userId,
            role: 'user',
            content: 'message 3',
            createdAt: new Date('2023-03-15'),
          },
          {
            id: 'date4',
            userId,
            role: 'user',
            content: 'message 4',
            createdAt: new Date('2023-04-15'),
          },
        ]);
      });

      it('should count messages with startDate filter', async () => {
        const result = await messageModel.count({ startDate: '2023-02-01' });
        expect(result).toBe(3); // messages from Feb 15, Mar 15, Apr 15
      });

      it('should count messages with endDate filter', async () => {
        const result = await messageModel.count({ endDate: '2023-03-01' });
        expect(result).toBe(2); // messages from Jan 15, Feb 15
      });

      it('should count messages with both startDate and endDate filters', async () => {
        const result = await messageModel.count({
          startDate: '2023-02-01',
          endDate: '2023-03-31',
        });
        expect(result).toBe(2); // messages from Feb 15, Mar 15
      });

      it('should count messages with range filter', async () => {
        const result = await messageModel.count({
          range: ['2023-02-01', '2023-04-01'],
        });
        expect(result).toBe(2); // messages from Feb 15, Mar 15
      });

      it('should handle edge cases in date filters', async () => {
        // Boundary dates
        const result1 = await messageModel.count({
          startDate: '2023-01-15',
          endDate: '2023-04-15',
        });
        expect(result1).toBe(4); // includes all messages

        // Date range with no messages
        const result2 = await messageModel.count({
          startDate: '2023-05-01',
          endDate: '2023-06-01',
        });
        expect(result2).toBe(0);

        // Exact to one day
        const result3 = await messageModel.count({
          startDate: '2023-01-15',
          endDate: '2023-01-15',
        });
        expect(result3).toBe(1);
      });
    });
  });

  describe('genId', () => {
    it('should generate unique message IDs', () => {
      const model = new MessageModel(serverDB, userId);
      // @ts-ignore - accessing private method for testing
      const id1 = model.genId();
      // @ts-ignore - accessing private method for testing
      const id2 = model.genId();

      expect(id1).toHaveLength(22);
      expect(id2).toHaveLength(22);
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^msg_/);
      expect(id2).toMatch(/^msg_/);
    });
  });

  describe('countWords', () => {
    it('should count total words of messages belonging to the user', async () => {
      // Create test data
      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'user', content: 'hello world' },
        { id: '2', userId, role: 'user', content: 'test message' },
        { id: '3', userId: otherUserId, role: 'user', content: 'other user message' },
      ]);

      // Call countWords method
      const result = await messageModel.countWords();

      // Assert result - 'hello world' + 'test message' = 23 characters
      expect(result).toEqual(23);
    });

    it('should count words within date range', async () => {
      // Create test data
      await serverDB.insert(messages).values([
        {
          id: '1',
          userId,
          role: 'user',
          content: 'old message',
          createdAt: new Date('2023-01-01'),
        },
        {
          id: '2',
          userId,
          role: 'user',
          content: 'new message',
          createdAt: new Date('2023-06-01'),
        },
      ]);

      // Call countWords method with date range
      const result = await messageModel.countWords({
        range: ['2023-05-01', '2023-07-01'],
      });

      // Assert result - only counts 'new message' = 11 characters
      expect(result).toEqual(11);
    });

    it('should handle empty content', async () => {
      // Create test data
      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'user', content: '' },
        { id: '2', userId, role: 'user', content: null },
      ]);

      // Call countWords method
      const result = await messageModel.countWords();

      // Assert result
      expect(result).toEqual(0);
    });

    it('should count words with startDate filter', async () => {
      await serverDB.insert(messages).values([
        {
          id: '1',
          userId,
          role: 'user',
          content: 'old message',
          createdAt: new Date('2023-01-01'),
        },
        {
          id: '2',
          userId,
          role: 'user',
          content: 'new message',
          createdAt: new Date('2023-03-01'),
        },
      ]);

      const result = await messageModel.countWords({ startDate: '2023-02-01' });

      // Only 'new message' should be counted = 11 characters
      expect(result).toEqual(11);
    });

    it('should count words with endDate filter', async () => {
      await serverDB.insert(messages).values([
        {
          id: '1',
          userId,
          role: 'user',
          content: 'old message',
          createdAt: new Date('2023-01-01'),
        },
        {
          id: '2',
          userId,
          role: 'user',
          content: 'new message',
          createdAt: new Date('2023-03-01'),
        },
      ]);

      const result = await messageModel.countWords({ endDate: '2023-02-01' });

      // Only 'old message' should be counted = 11 characters
      expect(result).toEqual(11);
    });
  });

  describe('getHeatmaps', () => {
    it('should return heatmap data for the last year', async () => {
      // Use fixed date for testing
      vi.useFakeTimers();
      const fixedDate = new Date('2023-04-07T13:00:00Z');
      vi.setSystemTime(fixedDate);

      const today = dayjs(fixedDate);
      const twoDaysAgoDate = today.subtract(2, 'day').format('YYYY-MM-DD');
      const oneDayAgoDate = today.subtract(1, 'day').format('YYYY-MM-DD');
      const todayDate = today.format('YYYY-MM-DD');

      // Create test data
      await serverDB.insert(messages).values([
        {
          id: '1',
          userId,
          role: 'user',
          content: 'message 1',
          createdAt: today.subtract(2, 'day').toDate(),
        },
        {
          id: '2',
          userId,
          role: 'user',
          content: 'message 2',
          createdAt: today.subtract(2, 'day').toDate(),
        },
        {
          id: '3',
          userId,
          role: 'user',
          content: 'message 3',
          createdAt: today.subtract(1, 'day').toDate(),
        },
      ]);

      // Call getHeatmaps method
      const result = await messageModel.getHeatmaps();

      // Assert result
      expect(result.length).toBeGreaterThanOrEqual(366);
      expect(result.length).toBeLessThan(368);

      // Check data from two days ago
      const twoDaysAgo = result.find((item) => item.date === twoDaysAgoDate);
      expect(twoDaysAgo?.count).toBe(2);
      expect(twoDaysAgo?.level).toBe(1);

      // Check data from one day ago
      const oneDayAgo = result.find((item) => item.date === oneDayAgoDate);
      expect(oneDayAgo?.count).toBe(1);
      expect(oneDayAgo?.level).toBe(1);

      // Check today's data
      const todayData = result.find((item) => item.date === todayDate);
      expect(todayData?.count).toBe(0);
      expect(todayData?.level).toBe(0);

      vi.useRealTimers();
    });

    it('should calculate correct levels based on message count', async () => {
      // Use fixed date for testing
      vi.useFakeTimers();
      const fixedDate = new Date('2023-05-15T12:00:00Z');
      vi.setSystemTime(fixedDate);

      const today = dayjs(fixedDate);
      const fourDaysAgoDate = today.subtract(4, 'day').format('YYYY-MM-DD');
      const threeDaysAgoDate = today.subtract(3, 'day').format('YYYY-MM-DD');
      const twoDaysAgoDate = today.subtract(2, 'day').format('YYYY-MM-DD');
      const oneDayAgoDate = today.subtract(1, 'day').format('YYYY-MM-DD');
      const todayDate = today.format('YYYY-MM-DD');

      // Create test data - different numbers of messages to test different levels
      await serverDB.insert(messages).values([
        // 1 message - level 1
        {
          id: '1',
          userId,
          role: 'user',
          content: 'message 1',
          createdAt: today.subtract(4, 'day').toDate(),
        },
        // 6 messages - level 2
        ...Array.from({ length: 6 })
          .fill(0)
          .map((_, i) => ({
            id: `2-${i}`,
            userId,
            role: 'user',
            content: `message 2-${i}`,
            createdAt: today.subtract(3, 'day').toDate(),
          })),
        // 11 messages - level 3
        ...Array.from({ length: 11 })
          .fill(0)
          .map((_, i) => ({
            id: `3-${i}`,
            userId,
            role: 'user',
            content: `message 3-${i}`,
            createdAt: today.subtract(2, 'day').toDate(),
          })),
        // 16 messages - level 4
        ...Array.from({ length: 16 })
          .fill(0)
          .map((_, i) => ({
            id: `4-${i}`,
            userId,
            role: 'user',
            content: `message 4-${i}`,
            createdAt: today.subtract(1, 'day').toDate(),
          })),
        // 21 messages - level 4
        ...Array.from({ length: 21 })
          .fill(0)
          .map((_, i) => ({
            id: `5-${i}`,
            userId,
            role: 'user',
            content: `message 5-${i}`,
            createdAt: today.toDate(),
          })),
      ]);

      // Call getHeatmaps method
      const result = await messageModel.getHeatmaps();

      // Check levels for different days
      const fourDaysAgo = result.find((item) => item.date === fourDaysAgoDate);
      expect(fourDaysAgo?.count).toBe(1);
      expect(fourDaysAgo?.level).toBe(1);

      const threeDaysAgo = result.find((item) => item.date === threeDaysAgoDate);
      expect(threeDaysAgo?.count).toBe(6);
      expect(threeDaysAgo?.level).toBe(2);

      const twoDaysAgo = result.find((item) => item.date === twoDaysAgoDate);
      expect(twoDaysAgo?.count).toBe(11);
      expect(twoDaysAgo?.level).toBe(3);

      const oneDayAgo = result.find((item) => item.date === oneDayAgoDate);
      expect(oneDayAgo?.count).toBe(16);
      expect(oneDayAgo?.level).toBe(4);

      const todayData = result.find((item) => item.date === todayDate);
      expect(todayData?.count).toBe(21);
      expect(todayData?.level).toBe(4);

      vi.useRealTimers();
    });

    it('should return time count correctly when 19:00 time', async () => {
      // Use fixed date for testing, use local time to avoid timezone issues
      vi.useFakeTimers();
      // Use local time at noon to avoid timezone edge cases
      const fixedDate = new Date('2025-04-02T12:00:00');
      vi.setSystemTime(fixedDate);

      const today = dayjs(fixedDate);
      const twoDaysAgoDate = today.subtract(2, 'day').format('YYYY-MM-DD');
      const oneDayAgoDate = today.subtract(1, 'day').format('YYYY-MM-DD');
      const todayDate = today.format('YYYY-MM-DD');

      // Create test data using explicit dates to avoid timezone issues
      await serverDB.insert(messages).values([
        {
          id: '1',
          userId,
          role: 'user',
          content: 'message 1',
          createdAt: new Date(twoDaysAgoDate + 'T10:00:00'),
        },
        {
          id: '2',
          userId,
          role: 'user',
          content: 'message 2',
          createdAt: new Date(twoDaysAgoDate + 'T14:00:00'),
        },
        {
          id: '3',
          userId,
          role: 'user',
          content: 'message 3',
          createdAt: new Date(oneDayAgoDate + 'T10:00:00'),
        },
      ]);

      // Call getHeatmaps method
      const result = await messageModel.getHeatmaps();

      // Assert result
      expect(result.length).toBeGreaterThanOrEqual(366);
      expect(result.length).toBeLessThan(368);

      // Check data from two days ago
      const twoDaysAgo = result.find((item) => item.date === twoDaysAgoDate);
      expect(twoDaysAgo?.count).toBe(2);
      expect(twoDaysAgo?.level).toBe(1);

      // Check data from one day ago
      const oneDayAgo = result.find((item) => item.date === oneDayAgoDate);
      expect(oneDayAgo?.count).toBe(1);
      expect(oneDayAgo?.level).toBe(1);

      // Check today's data
      const todayData = result.find((item) => item.date === todayDate);
      expect(todayData?.count).toBe(0);
      expect(todayData?.level).toBe(0);

      vi.useRealTimers();
    });

    it('should handle empty data', async () => {
      // Do not create any message data

      // Call getHeatmaps method
      const result = await messageModel.getHeatmaps();

      // Assert result
      expect(result.length).toBeGreaterThanOrEqual(366);
      expect(result.length).toBeLessThan(368);

      // Check that count and level are 0 for all data
      result.forEach((item) => {
        expect(item.count).toBe(0);
        expect(item.level).toBe(0);
      });
    });
  });

  describe('getTokenHeatmaps', () => {
    it('should sum assistant metadata.usage.totalTokens per day and scale levels', async () => {
      vi.useFakeTimers();
      const fixedDate = new Date('2023-04-07T13:00:00Z');
      vi.setSystemTime(fixedDate);

      const today = dayjs(fixedDate);
      const twoDaysAgoDate = today.subtract(2, 'day').format('YYYY-MM-DD');
      const oneDayAgoDate = today.subtract(1, 'day').format('YYYY-MM-DD');
      const todayDate = today.format('YYYY-MM-DD');

      await serverDB.insert(messages).values([
        // two days ago: 100 + 50 = 150 tokens
        {
          id: 'a1',
          userId,
          role: 'assistant',
          metadata: { usage: { totalTokens: 100 } },
          createdAt: today.subtract(2, 'day').toDate(),
        },
        {
          id: 'a2',
          userId,
          role: 'assistant',
          metadata: { usage: { totalTokens: 50 } },
          createdAt: today.subtract(2, 'day').toDate(),
        },
        // a non-assistant message with usage on the same day must be ignored
        {
          id: 'u1',
          userId,
          role: 'user',
          metadata: { usage: { totalTokens: 9999 } },
          createdAt: today.subtract(2, 'day').toDate(),
        },
        // one day ago: 300 tokens (busiest day -> level 4)
        {
          id: 'a3',
          userId,
          role: 'assistant',
          metadata: { usage: { totalTokens: 300 } },
          createdAt: today.subtract(1, 'day').toDate(),
        },
        // today: assistant message without usage -> contributes 0
        {
          id: 'a4',
          userId,
          role: 'assistant',
          metadata: {},
          createdAt: today.toDate(),
        },
        // another user's tokens must be ignored
        {
          id: 'o1',
          userId: otherUserId,
          role: 'assistant',
          metadata: { usage: { totalTokens: 8888 } },
          createdAt: today.subtract(1, 'day').toDate(),
        },
      ]);

      const result = await messageModel.getTokenHeatmaps();

      expect(result.length).toBeGreaterThanOrEqual(366);
      expect(result.length).toBeLessThan(368);

      const twoDaysAgo = result.find((item) => item.date === twoDaysAgoDate);
      expect(twoDaysAgo?.count).toBe(150);
      // 150 / 300 * 4 = 2
      expect(twoDaysAgo?.level).toBe(2);

      const oneDayAgo = result.find((item) => item.date === oneDayAgoDate);
      expect(oneDayAgo?.count).toBe(300);
      expect(oneDayAgo?.level).toBe(4);

      const todayData = result.find((item) => item.date === todayDate);
      expect(todayData?.count).toBe(0);
      expect(todayData?.level).toBe(0);

      vi.useRealTimers();
    });

    it('prefers the usage column and falls back to metadata.usage', async () => {
      vi.useFakeTimers();
      const fixedDate = new Date('2023-04-07T13:00:00Z');
      vi.setSystemTime(fixedDate);

      const today = dayjs(fixedDate);
      const dayKey = today.subtract(2, 'day').format('YYYY-MM-DD');

      await serverDB.insert(messages).values([
        // dedicated column wins over metadata.usage → contributes 100, not 9999
        {
          id: 'h1',
          userId,
          role: 'assistant',
          usage: { totalTokens: 100 } as any,
          metadata: { usage: { totalTokens: 9999 } },
          createdAt: today.subtract(2, 'day').toDate(),
        },
        // legacy row: only metadata.usage → falls back, contributes 50
        {
          id: 'h2',
          userId,
          role: 'assistant',
          metadata: { usage: { totalTokens: 50 } },
          createdAt: today.subtract(2, 'day').toDate(),
        },
      ]);

      const result = await messageModel.getTokenHeatmaps();
      const day = result.find((item) => item.date === dayKey);
      expect(day?.count).toBe(150);

      vi.useRealTimers();
    });

    it('should return all-zero data when there are no messages', async () => {
      const result = await messageModel.getTokenHeatmaps();

      expect(result.length).toBeGreaterThanOrEqual(366);
      expect(result.every((item) => item.count === 0 && item.level === 0)).toBe(true);
    });
  });

  describe('rankModels', () => {
    it('should rank models by usage count', async () => {
      // Create test data
      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'assistant', content: 'message 1', model: 'gpt-3.5' },
        { id: '2', userId, role: 'assistant', content: 'message 2', model: 'gpt-3.5' },
        { id: '3', userId, role: 'assistant', content: 'message 3', model: 'gpt-4' },
        { id: '4', userId: otherUserId, role: 'assistant', content: 'message 4', model: 'gpt-3.5' }, // other user's message
      ]);

      // Call rankModels method
      const result = await messageModel.rankModels();

      // Assert result
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: 'gpt-3.5', count: 2 }); // current user used gpt-3.5 twice
      expect(result[1]).toEqual({ id: 'gpt-4', count: 1 }); // current user used gpt-4 once
    });

    it('should only count messages with model field', async () => {
      // Create test data including messages without model field
      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'assistant', content: 'message 1', model: 'gpt-3.5' },
        { id: '2', userId, role: 'assistant', content: 'message 2', model: null },
        { id: '3', userId, role: 'user', content: 'message 3' }, // user messages typically have no model
      ]);

      // Call rankModels method
      const result = await messageModel.rankModels();

      // Assert result
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ id: 'gpt-3.5', count: 1 });
    });

    it('should return empty array when no models are used', async () => {
      // Create test data where all messages have no model
      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'user', content: 'message 1' },
        { id: '2', userId, role: 'assistant', content: 'message 2' },
      ]);

      // Call rankModels method
      const result = await messageModel.rankModels();

      // Assert result
      expect(result).toHaveLength(0);
    });

    it('should order models by count in descending order', async () => {
      // Create test data with models used different number of times
      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'assistant', content: 'message 1', model: 'gpt-4' },
        { id: '2', userId, role: 'assistant', content: 'message 2', model: 'gpt-3.5' },
        { id: '3', userId, role: 'assistant', content: 'message 3', model: 'gpt-3.5' },
        { id: '4', userId, role: 'assistant', content: 'message 4', model: 'claude' },
        { id: '5', userId, role: 'assistant', content: 'message 5', model: 'gpt-3.5' },
      ]);

      // Call rankModels method
      const result = await messageModel.rankModels();

      // Assert result
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ id: 'gpt-3.5', count: 3 }); // most used
      expect(result[1]).toEqual({ id: 'claude', count: 1 });
      expect(result[2]).toEqual({ id: 'gpt-4', count: 1 });
    });
  });

  describe('count with agent / topic / role filters', () => {
    const agentId = 'agent-count-filters';
    const topicA = 'topic-count-a';
    const topicB = 'topic-count-b';

    beforeEach(async () => {
      await serverDB.insert(agents).values([
        { id: agentId, userId },
        { id: 'agent-other', userId },
      ]);
      await serverDB.insert(topics).values([
        { id: topicA, userId, agentId, title: 'a' },
        { id: topicB, userId, agentId, title: 'b' },
      ]);
      await serverDB.insert(messages).values([
        { id: 'cf1', userId, role: 'user', content: 'q', agentId, topicId: topicA },
        { id: 'cf2', userId, role: 'assistant', content: 'a', agentId, topicId: topicA },
        { id: 'cf3', userId, role: 'user', content: 'q2', agentId, topicId: topicB },
        // another agent / no topic
        { id: 'cf4', userId, role: 'user', content: 'other', agentId: 'agent-other' },
      ]);
    });

    it('filters by agentId', async () => {
      expect(await messageModel.count({ agentId })).toBe(3);
    });

    it('filters by topicId', async () => {
      expect(await messageModel.count({ topicId: topicA })).toBe(2);
    });

    it('filters by role', async () => {
      expect(await messageModel.count({ agentId, role: 'user' })).toBe(2);
    });

    it('combines filters', async () => {
      expect(await messageModel.count({ agentId, role: 'user', topicId: topicB })).toBe(1);
    });
  });

  describe('countGroupByTopic', () => {
    const agentId = 'agent-count-by-topic';
    const topicA = 'topic-cbt-a';
    const topicB = 'topic-cbt-b';

    beforeEach(async () => {
      await serverDB.insert(agents).values({ id: agentId, userId });
      await serverDB.insert(topics).values([
        { id: topicA, userId, agentId, title: 'a' },
        { id: topicB, userId, agentId, title: 'b' },
      ]);
      await serverDB.insert(messages).values([
        { id: 'g1', userId, role: 'user', content: '1', agentId, topicId: topicA },
        { id: 'g2', userId, role: 'user', content: '2', agentId, topicId: topicA },
        { id: 'g3', userId, role: 'user', content: '3', agentId, topicId: topicA },
        { id: 'g4', userId, role: 'user', content: '4', agentId, topicId: topicB },
        // assistant + null-topic rows must be excluded by role / topic filters
        { id: 'g5', userId, role: 'assistant', content: 'x', agentId, topicId: topicA },
        { id: 'g6', userId, role: 'user', content: 'no-topic', agentId },
        // other user must not leak
        { id: 'g7', userId: otherUserId, role: 'user', content: 'leak', topicId: topicA },
      ]);
    });

    it('returns per-topic counts sorted by count desc', async () => {
      const result = await messageModel.countGroupByTopic({ agentId, role: 'user' });
      expect(result).toEqual([
        { count: 3, topicId: topicA },
        { count: 1, topicId: topicB },
      ]);
    });

    it('excludes rows without a topicId', async () => {
      const result = await messageModel.countGroupByTopic({ agentId });
      // g6 (no topic) excluded; topicA has 3 user + 1 assistant = 4, topicB has 1
      expect(result).toEqual([
        { count: 4, topicId: topicA },
        { count: 1, topicId: topicB },
      ]);
    });
  });

  describe('topicMessageStats', () => {
    const agentId = 'agent-topic-stats';
    const otherAgentId = 'agent-topic-stats-other';

    beforeEach(async () => {
      await serverDB.insert(agents).values([
        { id: agentId, userId },
        { id: otherAgentId, userId },
      ]);
      // 4 topics under agentId with 1 / 2 / 3 / 4 user messages each,
      // plus one topic under another agent that must be excluded by the filter.
      const topicRows = [
        { id: 's-t1', count: 1 },
        { id: 's-t2', count: 2 },
        { id: 's-t3', count: 3 },
        { id: 's-t4', count: 4 },
      ];
      await serverDB.insert(topics).values([
        ...topicRows.map((t) => ({ id: t.id, userId, agentId, title: t.id })),
        { id: 's-other', userId, agentId: otherAgentId, title: 'other' },
      ]);

      const msgRows = topicRows.flatMap((t) =>
        Array.from({ length: t.count }).map((_, i) => ({
          id: `${t.id}-u${i}`,
          userId,
          role: 'user',
          content: `m${i}`,
          agentId,
          topicId: t.id,
        })),
      );
      await serverDB.insert(messages).values([
        ...msgRows,
        // assistant messages in agentId topics — excluded by role=user
        { id: 's-t1-a', userId, role: 'assistant', content: 'a', agentId, topicId: 's-t1' },
        // other agent's topic
        { id: 's-other-u', userId, role: 'user', content: 'x', agentId: otherAgentId, topicId: 's-other' },
        // other user must not leak
        { id: 's-leak', userId: otherUserId, role: 'user', content: 'leak', topicId: 's-t1' },
      ]);
    });

    it('computes the per-topic distribution scoped by agent + role', async () => {
      const stats = await messageModel.topicMessageStats({ agentId, role: 'user' });

      expect(stats.topics).toBe(4);
      expect(stats.totalMessages).toBe(10);
      expect(stats.min).toBe(1);
      expect(stats.max).toBe(4);
      expect(stats.mean).toBe(2.5);
      // percentile_cont over [1,2,3,4]
      expect(stats.median).toBeCloseTo(2.5);
      expect(stats.p90).toBeCloseTo(3.7);
      expect(stats.oneshot).toBe(1);
      expect(stats.oneshotRatio).toBeCloseTo(0.25);
      expect(stats.histogram).toEqual([
        { topics: 1, userCount: 1 },
        { topics: 1, userCount: 2 },
        { topics: 1, userCount: 3 },
        { topics: 1, userCount: 4 },
      ]);
    });

    it('returns an all-zero summary when nothing matches', async () => {
      const stats = await messageModel.topicMessageStats({ agentId: 'no-such-agent' });
      expect(stats).toEqual({
        histogram: [],
        max: 0,
        mean: 0,
        median: 0,
        min: 0,
        oneshot: 0,
        oneshotRatio: 0,
        p90: 0,
        p99: 0,
        topics: 0,
        totalMessages: 0,
      });
    });

    it('does not leak other users’ topics', async () => {
      const otherModel = new MessageModel(serverDB, otherUserId);
      const stats = await otherModel.topicMessageStats({ role: 'user' });
      // otherUser only has the single leaked message in s-t1
      expect(stats.topics).toBe(1);
      expect(stats.totalMessages).toBe(1);
    });
  });

  describe('hasMoreThanN', () => {
    it('should return true when message count is greater than N', async () => {
      // Create test data
      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'user', content: 'message 1' },
        { id: '2', userId, role: 'user', content: 'message 2' },
        { id: '3', userId, role: 'user', content: 'message 3' },
      ]);

      // Test different N values
      const result1 = await messageModel.hasMoreThanN(2); // 3 > 2
      const result2 = await messageModel.hasMoreThanN(3); // 3 ≯ 3
      const result3 = await messageModel.hasMoreThanN(4); // 3 ≯ 4

      expect(result1).toBe(true);
      expect(result2).toBe(false);
      expect(result3).toBe(false);
    });

    it('should only count messages belonging to the user', async () => {
      // Create test data including messages from other users
      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'user', content: 'message 1' },
        { id: '2', userId, role: 'user', content: 'message 2' },
        { id: '3', userId: otherUserId, role: 'user', content: 'message 3' }, // other user's message
      ]);

      const result = await messageModel.hasMoreThanN(2);

      expect(result).toBe(false); // current user only has 2 messages, not greater than 2
    });

    it('should return false when no messages exist', async () => {
      const result = await messageModel.hasMoreThanN(0);
      expect(result).toBe(false);
    });

    it('should handle edge cases', async () => {
      // Create a single message
      await serverDB
        .insert(messages)
        .values([{ id: '1', userId, role: 'user', content: 'message 1' }]);

      // Test edge cases
      const result1 = await messageModel.hasMoreThanN(0); // 1 > 0
      const result2 = await messageModel.hasMoreThanN(1); // 1 ≯ 1
      const result3 = await messageModel.hasMoreThanN(-1); // 1 > -1

      expect(result1).toBe(true);
      expect(result2).toBe(false);
      expect(result3).toBe(true);
    });
  });

  describe('countUpTo', () => {
    it('should count messages up to a limit', async () => {
      await serverDB.insert(messages).values([
        { id: 'count-1', userId, role: 'user', content: 'msg 1' },
        { id: 'count-2', userId, role: 'user', content: 'msg 2' },
        { id: 'count-3', userId, role: 'user', content: 'msg 3' },
      ]);

      const result = await messageModel.countUpTo(5);
      expect(result).toBe(3);
    });

    it('should return at most n', async () => {
      await serverDB.insert(messages).values([
        { id: 'count-a', userId, role: 'user', content: 'msg a' },
        { id: 'count-b', userId, role: 'user', content: 'msg b' },
        { id: 'count-c', userId, role: 'user', content: 'msg c' },
      ]);

      const result = await messageModel.countUpTo(2);
      expect(result).toBe(2);
    });

    it('should return 0 for empty user', async () => {
      const otherModel = new MessageModel(serverDB, 'empty-count-user');
      await serverDB.insert(users).values({ id: 'empty-count-user' });
      const result = await otherModel.countUpTo(10);
      expect(result).toBe(0);
    });
  });

  describe('hasTopicMessages', () => {
    const agentId = 'agent-has-topic-messages';
    const topicWithMessages = 'topic-with-messages';
    const emptyTopic = 'topic-empty';

    beforeEach(async () => {
      await serverDB.insert(agents).values({ id: agentId, userId });
      await serverDB.insert(topics).values([
        { id: topicWithMessages, userId, agentId, title: 'with-messages' },
        { id: emptyTopic, userId, agentId, title: 'empty' },
      ]);
      await serverDB
        .insert(messages)
        .values([
          { id: 'm1', userId, role: 'assistant', content: 'hi', topicId: topicWithMessages },
        ]);
    });

    it('returns true when topic has at least one message', async () => {
      const result = await messageModel.hasTopicMessages(topicWithMessages);
      expect(result).toBe(true);
    });

    it('returns false when topic has no messages', async () => {
      const result = await messageModel.hasTopicMessages(emptyTopic);
      expect(result).toBe(false);
    });

    it('scopes by userId — other users’ messages do not leak', async () => {
      const otherModel = new MessageModel(serverDB, otherUserId);
      const result = await otherModel.hasTopicMessages(topicWithMessages);
      expect(result).toBe(false);
    });
  });

  describe('findFirstAssistantInTopic', () => {
    const agentId = 'agent-find-first-assistant';
    const topicId = 'topic-find-first-assistant';

    beforeEach(async () => {
      await serverDB.insert(agents).values({ id: agentId, userId });
      await serverDB.insert(topics).values({ id: topicId, userId, agentId, title: 'topic' });
    });

    it('returns undefined when no assistant message exists', async () => {
      await serverDB
        .insert(messages)
        .values([
          { id: 'u1', userId, role: 'user', content: 'hi', topicId, createdAt: new Date(1) },
        ]);

      const result = await messageModel.findFirstAssistantInTopic(topicId);
      expect(result).toBeUndefined();
    });

    it('returns the earliest assistant message in the topic', async () => {
      await serverDB.insert(messages).values([
        { id: 'u1', userId, role: 'user', content: 'hi', topicId, createdAt: new Date(2) },
        { id: 'a-late', userId, role: 'assistant', content: 'b', topicId, createdAt: new Date(3) },
        { id: 'a-early', userId, role: 'assistant', content: 'a', topicId, createdAt: new Date(1) },
      ]);

      const result = await messageModel.findFirstAssistantInTopic(topicId);
      expect(result?.id).toBe('a-early');
    });
  });
});
