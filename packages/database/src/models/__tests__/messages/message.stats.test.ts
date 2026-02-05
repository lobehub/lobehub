import dayjs from 'dayjs';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { uuid } from '@/utils/uuid';

import { getTestDB } from '../../../core/getTestDB';
import { embeddings, files, messages, sessions, users } from '../../../schemas';
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
      userId: userId,
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

      // 调用 count 方法
      const result = await messageModel.count();

      // Assert result
      expect(result).toBe(2);
    });

    describe('count with date filters', () => {
      beforeEach(async () => {
        // Create test data，包含不同日期的消息
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
        expect(result).toBe(3); // 2月15日, 3月15日, 4月15日的消息
      });

      it('should count messages with endDate filter', async () => {
        const result = await messageModel.count({ endDate: '2023-03-01' });
        expect(result).toBe(2); // 1月15日, 2月15日的消息
      });

      it('should count messages with both startDate and endDate filters', async () => {
        const result = await messageModel.count({
          startDate: '2023-02-01',
          endDate: '2023-03-31',
        });
        expect(result).toBe(2); // 2月15日, 3月15日的消息
      });

      it('should count messages with range filter', async () => {
        const result = await messageModel.count({
          range: ['2023-02-01', '2023-04-01'],
        });
        expect(result).toBe(2); // 2月15日, 3月15日的消息
      });

      it('should handle edge cases in date filters', async () => {
        // 边界日期
        const result1 = await messageModel.count({
          startDate: '2023-01-15',
          endDate: '2023-04-15',
        });
        expect(result1).toBe(4); // 包含所有消息

        // 没有消息的日期范围
        const result2 = await messageModel.count({
          startDate: '2023-05-01',
          endDate: '2023-06-01',
        });
        expect(result2).toBe(0);

        // 精确到一天
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

      expect(id1).toHaveLength(18);
      expect(id2).toHaveLength(18);
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

      // 调用 countWords 方法
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

      // 调用 countWords 方法，设置日期范围
      const result = await messageModel.countWords({
        range: ['2023-05-01', '2023-07-01'],
      });

      // Assert result - 只计算 'new message' = 11 characters
      expect(result).toEqual(11);
    });

    it('should handle empty content', async () => {
      // Create test data
      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'user', content: '' },
        { id: '2', userId, role: 'user', content: null },
      ]);

      // 调用 countWords 方法
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
      // 使用固定日期进行测试
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

      // 调用 getHeatmaps 方法
      const result = await messageModel.getHeatmaps();

      // Assert result
      expect(result.length).toBeGreaterThanOrEqual(366);
      expect(result.length).toBeLessThan(368);

      // 检查两天前的数据
      const twoDaysAgo = result.find((item) => item.date === twoDaysAgoDate);
      expect(twoDaysAgo?.count).toBe(2);
      expect(twoDaysAgo?.level).toBe(1);

      // 检查一天前的数据
      const oneDayAgo = result.find((item) => item.date === oneDayAgoDate);
      expect(oneDayAgo?.count).toBe(1);
      expect(oneDayAgo?.level).toBe(1);

      // 检查今天的数据
      const todayData = result.find((item) => item.date === todayDate);
      expect(todayData?.count).toBe(0);
      expect(todayData?.level).toBe(0);

      vi.useRealTimers();
    });

    it('should calculate correct levels based on message count', async () => {
      // 使用固定日期进行测试
      vi.useFakeTimers();
      const fixedDate = new Date('2023-05-15T12:00:00Z');
      vi.setSystemTime(fixedDate);

      const today = dayjs(fixedDate);
      const fourDaysAgoDate = today.subtract(4, 'day').format('YYYY-MM-DD');
      const threeDaysAgoDate = today.subtract(3, 'day').format('YYYY-MM-DD');
      const twoDaysAgoDate = today.subtract(2, 'day').format('YYYY-MM-DD');
      const oneDayAgoDate = today.subtract(1, 'day').format('YYYY-MM-DD');
      const todayDate = today.format('YYYY-MM-DD');

      // Create test data - 不同数量的消息以测试不同的等级
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

      // 调用 getHeatmaps 方法
      const result = await messageModel.getHeatmaps();

      // 检查不同天数的等级
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
      // 使用固定日期进行测试，使用本地时间避免时区问题
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

      // 调用 getHeatmaps 方法
      const result = await messageModel.getHeatmaps();

      // Assert result
      expect(result.length).toBeGreaterThanOrEqual(366);
      expect(result.length).toBeLessThan(368);

      // 检查两天前的数据
      const twoDaysAgo = result.find((item) => item.date === twoDaysAgoDate);
      expect(twoDaysAgo?.count).toBe(2);
      expect(twoDaysAgo?.level).toBe(1);

      // 检查一天前的数据
      const oneDayAgo = result.find((item) => item.date === oneDayAgoDate);
      expect(oneDayAgo?.count).toBe(1);
      expect(oneDayAgo?.level).toBe(1);

      // 检查今天的数据
      const todayData = result.find((item) => item.date === todayDate);
      expect(todayData?.count).toBe(0);
      expect(todayData?.level).toBe(0);

      vi.useRealTimers();
    });

    it('should handle empty data', async () => {
      // 不创建任何消息数据

      // 调用 getHeatmaps 方法
      const result = await messageModel.getHeatmaps();

      // Assert result
      expect(result.length).toBeGreaterThanOrEqual(366);
      expect(result.length).toBeLessThan(368);

      // 检查所有数据的 count 和 level 是否为 0
      result.forEach((item) => {
        expect(item.count).toBe(0);
        expect(item.level).toBe(0);
      });
    });
  });

  describe('rankModels', () => {
    it('should rank models by usage count', async () => {
      // Create test data
      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'assistant', content: 'message 1', model: 'gpt-3.5' },
        { id: '2', userId, role: 'assistant', content: 'message 2', model: 'gpt-3.5' },
        { id: '3', userId, role: 'assistant', content: 'message 3', model: 'gpt-4' },
        { id: '4', userId: otherUserId, role: 'assistant', content: 'message 4', model: 'gpt-3.5' }, // 其他用户的消息
      ]);

      // 调用 rankModels 方法
      const result = await messageModel.rankModels();

      // Assert result
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: 'gpt-3.5', count: 2 }); // 当前用户使用 gpt-3.5 两次
      expect(result[1]).toEqual({ id: 'gpt-4', count: 1 }); // 当前用户使用 gpt-4 一次
    });

    it('should only count messages with model field', async () => {
      // Create test data，包括没有 model 字段的消息
      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'assistant', content: 'message 1', model: 'gpt-3.5' },
        { id: '2', userId, role: 'assistant', content: 'message 2', model: null },
        { id: '3', userId, role: 'user', content: 'message 3' }, // 用户消息通常没有 model
      ]);

      // 调用 rankModels 方法
      const result = await messageModel.rankModels();

      // Assert result
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ id: 'gpt-3.5', count: 1 });
    });

    it('should return empty array when no models are used', async () => {
      // Create test data，所有消息都没有 model
      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'user', content: 'message 1' },
        { id: '2', userId, role: 'assistant', content: 'message 2' },
      ]);

      // 调用 rankModels 方法
      const result = await messageModel.rankModels();

      // Assert result
      expect(result).toHaveLength(0);
    });

    it('should order models by count in descending order', async () => {
      // Create test data，使用不同次数的模型
      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'assistant', content: 'message 1', model: 'gpt-4' },
        { id: '2', userId, role: 'assistant', content: 'message 2', model: 'gpt-3.5' },
        { id: '3', userId, role: 'assistant', content: 'message 3', model: 'gpt-3.5' },
        { id: '4', userId, role: 'assistant', content: 'message 4', model: 'claude' },
        { id: '5', userId, role: 'assistant', content: 'message 5', model: 'gpt-3.5' },
      ]);

      // 调用 rankModels 方法
      const result = await messageModel.rankModels();

      // Assert result
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ id: 'gpt-3.5', count: 3 }); // 最多使用
      expect(result[1]).toEqual({ id: 'claude', count: 1 });
      expect(result[2]).toEqual({ id: 'gpt-4', count: 1 });
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

      // 测试不同的 N 值
      const result1 = await messageModel.hasMoreThanN(2); // 3 > 2
      const result2 = await messageModel.hasMoreThanN(3); // 3 ≯ 3
      const result3 = await messageModel.hasMoreThanN(4); // 3 ≯ 4

      expect(result1).toBe(true);
      expect(result2).toBe(false);
      expect(result3).toBe(false);
    });

    it('should only count messages belonging to the user', async () => {
      // Create test data，包括其他用户的消息
      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'user', content: 'message 1' },
        { id: '2', userId, role: 'user', content: 'message 2' },
        { id: '3', userId: otherUserId, role: 'user', content: 'message 3' }, // 其他用户的消息
      ]);

      const result = await messageModel.hasMoreThanN(2);

      expect(result).toBe(false); // 当前用户只有 2 条消息，不大于 2
    });

    it('should return false when no messages exist', async () => {
      const result = await messageModel.hasMoreThanN(0);
      expect(result).toBe(false);
    });

    it('should handle edge cases', async () => {
      // 创建一条消息
      await serverDB
        .insert(messages)
        .values([{ id: '1', userId, role: 'user', content: 'message 1' }]);

      // 测试边界情况
      const result1 = await messageModel.hasMoreThanN(0); // 1 > 0
      const result2 = await messageModel.hasMoreThanN(1); // 1 ≯ 1
      const result3 = await messageModel.hasMoreThanN(-1); // 1 > -1

      expect(result1).toBe(true);
      expect(result2).toBe(false);
      expect(result3).toBe(true);
    });
  });
});
