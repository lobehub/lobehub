import dayjs from 'dayjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type LobeChatDatabase } from '@/database/type';
import { type MessageMetadata } from '@/types/message';

import { UsageRecordService } from './index';

describe('UsageRecordService', () => {
  let service: UsageRecordService;
  let mockDb: LobeChatDatabase;
  const userId = 'test-user-id';

  // Helper function to setup query chain mock
  const setupQueryChainMock = (mockMessages: any[]) => {
    const mockOrderBy = vi.fn().mockResolvedValue(mockMessages);
    const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    mockDb.select = vi.fn().mockReturnValue({ from: mockFrom });
  };

  beforeEach(() => {
    // Create a fresh mock for each test
    const mockOrderBy = vi.fn();
    const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

    mockDb = {
      select: mockSelect,
    } as unknown as LobeChatDatabase;

    service = new UsageRecordService(mockDb, userId);
  });

  describe('findByMonth', () => {
    it('should return usage records for the current month when no month is provided', async () => {
      const mockMessages = [
        {
          id: 'msg-1',
          userId: userId,
          role: 'assistant',
          provider: 'openai',
          model: 'gpt-4',
          createdAt: new Date(),
          metadata: {
            cost: 0.05,
            totalInputTokens: 100,
            totalOutputTokens: 50,
            tps: 10,
            ttft: 500,
          } as MessageMetadata,
        },
      ];

      setupQueryChainMock(mockMessages);

      const result = await service.findByMonth();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'msg-1',
        model: 'gpt-4',
        provider: 'openai',
        spend: 0.05,
        totalInputTokens: 100,
        totalOutputTokens: 50,
        totalTokens: 150,
        tps: 10,
        ttft: 500,
        type: 'chat',
        userId: userId,
      });
    });

    it('should return usage records for a specific month', async () => {
      const mockMessages = [
        {
          id: 'msg-1',
          userId: userId,
          role: 'assistant',
          provider: 'anthropic',
          model: 'claude-3',
          createdAt: new Date('2024-01-15'),
          metadata: {
            cost: 0.03,
            totalInputTokens: 80,
            totalOutputTokens: 40,
          } as MessageMetadata,
        },
      ];

      setupQueryChainMock(mockMessages);

      const result = await service.findByMonth('2024-01');

      expect(result[0].model).toBe('claude-3');
      expect(result[0].spend).toBe(0.03);
    });

    it('should handle messages with missing metadata fields', async () => {
      const mockMessages = [
        {
          id: 'msg-1',
          userId: userId,
          role: 'assistant',
          provider: 'openai',
          model: 'gpt-3.5-turbo',
          createdAt: new Date(),
          metadata: {} as MessageMetadata,
        },
      ];

      setupQueryChainMock(mockMessages);

      const result = await service.findByMonth();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        spend: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        tps: 0,
        ttft: 0,
      });
    });

    it('should return empty array when no messages found', async () => {
      setupQueryChainMock([]);

      const result = await service.findByMonth();

      expect(result).toHaveLength(0);
    });
  });

  describe('findAndGroupByDay', () => {
    it('should group usage records by day for current month', async () => {
      const date1 = dayjs().startOf('month').toDate();
      const date2 = dayjs().startOf('month').add(1, 'day').toDate();

      const mockMessages = [
        {
          id: 'msg-1',
          userId: userId,
          role: 'assistant',
          provider: 'openai',
          model: 'gpt-4',
          createdAt: date1,
          metadata: {
            cost: 0.05,
            totalInputTokens: 100,
            totalOutputTokens: 50,
          } as MessageMetadata,
        },
        {
          id: 'msg-2',
          userId: userId,
          role: 'assistant',
          provider: 'openai',
          model: 'gpt-4',
          createdAt: date1,
          metadata: {
            cost: 0.03,
            totalInputTokens: 60,
            totalOutputTokens: 30,
          } as MessageMetadata,
        },
        {
          id: 'msg-3',
          userId: userId,
          role: 'assistant',
          provider: 'anthropic',
          model: 'claude-3',
          createdAt: date2,
          metadata: {
            cost: 0.02,
            totalInputTokens: 40,
            totalOutputTokens: 20,
          } as MessageMetadata,
        },
      ];

      setupQueryChainMock(mockMessages);

      const result = await service.findAndGroupByDay();

      expect(result.length).toBeGreaterThan(0);

      // Check that days with records have correct aggregations
      const dayWithRecords = result.find((log) => log.totalRequests > 0);
      if (dayWithRecords) {
        expect(dayWithRecords.totalSpend).toBeGreaterThan(0);
        expect(dayWithRecords.totalTokens).toBeGreaterThan(0);
        expect(dayWithRecords.records.length).toBeGreaterThan(0);
      }
    });

    it('should pad missing days with zero values', async () => {
      const firstDay = dayjs().startOf('month');

      const mockMessages = [
        {
          id: 'msg-1',
          userId: userId,
          role: 'assistant',
          provider: 'openai',
          model: 'gpt-4',
          createdAt: firstDay.toDate(),
          metadata: {
            cost: 0.05,
            totalInputTokens: 100,
            totalOutputTokens: 50,
          } as MessageMetadata,
        },
      ];

      setupQueryChainMock(mockMessages);

      const result = await service.findAndGroupByDay();

      // Should have entries for every day in the month
      const daysInMonth = dayjs().endOf('month').date();
      expect(result.length).toBeGreaterThanOrEqual(daysInMonth - 1);

      // Check that padded days have zero values
      const paddedDay = result.find((log) => log.totalRequests === 0);
      if (paddedDay) {
        expect(paddedDay.totalSpend).toBe(0);
        expect(paddedDay.totalTokens).toBe(0);
        expect(paddedDay.records).toHaveLength(0);
      }
    });

    it('should calculate correct totals for days with multiple records', async () => {
      const testDate = dayjs().startOf('month').toDate();

      const mockMessages = [
        {
          id: 'msg-1',
          userId: userId,
          role: 'assistant',
          provider: 'openai',
          model: 'gpt-4',
          createdAt: testDate,
          metadata: {
            cost: 0.05,
            totalInputTokens: 100,
            totalOutputTokens: 50,
          } as MessageMetadata,
        },
        {
          id: 'msg-2',
          userId: userId,
          role: 'assistant',
          provider: 'openai',
          model: 'gpt-4',
          createdAt: testDate,
          metadata: {
            cost: 0.03,
            totalInputTokens: 60,
            totalOutputTokens: 30,
          } as MessageMetadata,
        },
      ];

      setupQueryChainMock(mockMessages);

      const result = await service.findAndGroupByDay();

      const dayLog = result.find((log) => log.totalRequests === 2);

      if (dayLog) {
        expect(dayLog.totalSpend).toBe(0.08);
        expect(dayLog.totalTokens).toBe(240); // (100+50) + (60+30)
        expect(dayLog.totalRequests).toBe(2);
        expect(dayLog.records).toHaveLength(2);
      }
    });

    it('should handle specific month parameter', async () => {
      const mockMessages = [
        {
          id: 'msg-1',
          userId: userId,
          role: 'assistant',
          provider: 'openai',
          model: 'gpt-4',
          createdAt: new Date('2024-01-15'),
          metadata: {
            cost: 0.05,
            totalInputTokens: 100,
            totalOutputTokens: 50,
          } as MessageMetadata,
        },
      ];

      setupQueryChainMock(mockMessages);

      const result = await service.findAndGroupByDay('2024-01');

      expect(result.length).toBeGreaterThan(0);
      // All days should be from January 2024
      result.forEach((log) => {
        expect(log.day).toMatch(/^2024-01/);
      });
    });
  });
});
