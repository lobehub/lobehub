// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

import { BotConnectQueue } from './botConnectQueue';

// Mock the redis client
const mockRedis = {
  hset: vi.fn(),
  hgetall: vi.fn(),
  hdel: vi.fn(),
};

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: vi.fn(() => mockRedis),
}));

describe('BotConnectQueue', () => {
  let queue: BotConnectQueue;

  beforeEach(() => {
    queue = new BotConnectQueue();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('push', () => {
    it('should enqueue a connect request into Redis', async () => {
      mockRedis.hset.mockResolvedValue(1);

      await queue.push('slack', 'app-123', 'user-abc');

      expect(mockRedis.hset).toHaveBeenCalledWith(
        'bot:gateway:connect_queue',
        'slack:app-123',
        expect.stringContaining('"userId":"user-abc"'),
      );
    });

    it('should include a timestamp in the stored value', async () => {
      mockRedis.hset.mockResolvedValue(1);
      const beforeTime = Date.now();

      await queue.push('discord', 'app-456', 'user-xyz');

      const afterTime = Date.now();
      const callArgs = mockRedis.hset.mock.calls[0];
      const storedValue = JSON.parse(callArgs[2]);

      expect(storedValue.timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(storedValue.timestamp).toBeLessThanOrEqual(afterTime);
      expect(storedValue.userId).toBe('user-xyz');
    });

    it('should throw an error when Redis is not available', async () => {
      vi.mocked(getAgentRuntimeRedisClient).mockReturnValueOnce(null);

      await expect(queue.push('slack', 'app-123', 'user-abc')).rejects.toThrow(
        'Redis is not available, cannot enqueue bot connect request',
      );
      expect(mockRedis.hset).not.toHaveBeenCalled();
    });

    it('should use platform:applicationId as the Redis hash field', async () => {
      mockRedis.hset.mockResolvedValue(1);

      await queue.push('telegram', 'bot-789', 'user-001');

      expect(mockRedis.hset).toHaveBeenCalledWith(
        'bot:gateway:connect_queue',
        'telegram:bot-789',
        expect.any(String),
      );
    });
  });

  describe('popAll', () => {
    it('should return empty array when Redis is not available', async () => {
      vi.mocked(getAgentRuntimeRedisClient).mockReturnValueOnce(null);

      const result = await queue.popAll();

      expect(result).toEqual([]);
      expect(mockRedis.hgetall).not.toHaveBeenCalled();
    });

    it('should return empty array when hash is empty', async () => {
      mockRedis.hgetall.mockResolvedValue({});

      const result = await queue.popAll();

      expect(result).toEqual([]);
    });

    it('should return empty array when hgetall returns null', async () => {
      mockRedis.hgetall.mockResolvedValue(null);

      const result = await queue.popAll();

      expect(result).toEqual([]);
    });

    it('should parse and return valid non-expired entries', async () => {
      const now = Date.now();
      mockRedis.hgetall.mockResolvedValue({
        'slack:app-123': JSON.stringify({ timestamp: now, userId: 'user-abc' }),
        'discord:app-456': JSON.stringify({ timestamp: now, userId: 'user-def' }),
      });
      mockRedis.hdel.mockResolvedValue(0);

      const result = await queue.popAll();

      expect(result).toHaveLength(2);
      expect(result).toContainEqual({
        platform: 'slack',
        applicationId: 'app-123',
        userId: 'user-abc',
      });
      expect(result).toContainEqual({
        platform: 'discord',
        applicationId: 'app-456',
        userId: 'user-def',
      });
    });

    it('should filter out expired entries and clean them from Redis', async () => {
      const expiredTimestamp = Date.now() - 11 * 60 * 1000; // 11 minutes ago (expired)
      const validTimestamp = Date.now(); // now (valid)

      mockRedis.hgetall.mockResolvedValue({
        'slack:expired-app': JSON.stringify({ timestamp: expiredTimestamp, userId: 'user-old' }),
        'discord:valid-app': JSON.stringify({ timestamp: validTimestamp, userId: 'user-new' }),
      });
      mockRedis.hdel.mockResolvedValue(1);

      const result = await queue.popAll();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        platform: 'discord',
        applicationId: 'valid-app',
        userId: 'user-new',
      });

      // Expired entry should have been deleted
      expect(mockRedis.hdel).toHaveBeenCalledWith('bot:gateway:connect_queue', 'slack:expired-app');
    });

    it('should handle malformed JSON entries by treating them as expired', async () => {
      const validTimestamp = Date.now();
      mockRedis.hgetall.mockResolvedValue({
        'slack:bad-app': 'not-valid-json{{{',
        'discord:good-app': JSON.stringify({ timestamp: validTimestamp, userId: 'user-ok' }),
      });
      mockRedis.hdel.mockResolvedValue(1);

      const result = await queue.popAll();

      expect(result).toHaveLength(1);
      expect(result[0].platform).toBe('discord');

      // Malformed entry should have been deleted
      expect(mockRedis.hdel).toHaveBeenCalledWith('bot:gateway:connect_queue', 'slack:bad-app');
    });

    it('should skip entries where field has no colon separator', async () => {
      const now = Date.now();
      mockRedis.hgetall.mockResolvedValue({
        'noseparator': JSON.stringify({ timestamp: now, userId: 'user-abc' }),
        'slack:valid': JSON.stringify({ timestamp: now, userId: 'user-valid' }),
      });
      mockRedis.hdel.mockResolvedValue(0);

      const result = await queue.popAll();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        platform: 'slack',
        applicationId: 'valid',
        userId: 'user-valid',
      });
    });

    it('should correctly parse applicationId that contains colons', async () => {
      const now = Date.now();
      // Application IDs with colons in them — platform is everything before first colon
      mockRedis.hgetall.mockResolvedValue({
        'slack:app:with:colons': JSON.stringify({ timestamp: now, userId: 'user-abc' }),
      });
      mockRedis.hdel.mockResolvedValue(0);

      const result = await queue.popAll();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        platform: 'slack',
        applicationId: 'app:with:colons',
        userId: 'user-abc',
      });
    });

    it('should not call hdel when there are no expired entries', async () => {
      const now = Date.now();
      mockRedis.hgetall.mockResolvedValue({
        'slack:app-123': JSON.stringify({ timestamp: now, userId: 'user-abc' }),
      });

      const result = await queue.popAll();

      expect(result).toHaveLength(1);
      expect(mockRedis.hdel).not.toHaveBeenCalled();
    });

    it('should batch delete all expired entries in a single hdel call', async () => {
      const expiredTs = Date.now() - 15 * 60 * 1000;
      mockRedis.hgetall.mockResolvedValue({
        'slack:expired-1': JSON.stringify({ timestamp: expiredTs, userId: 'u1' }),
        'discord:expired-2': JSON.stringify({ timestamp: expiredTs, userId: 'u2' }),
        'telegram:expired-3': JSON.stringify({ timestamp: expiredTs, userId: 'u3' }),
      });
      mockRedis.hdel.mockResolvedValue(3);

      const result = await queue.popAll();

      expect(result).toHaveLength(0);
      expect(mockRedis.hdel).toHaveBeenCalledTimes(1);
      expect(mockRedis.hdel).toHaveBeenCalledWith(
        'bot:gateway:connect_queue',
        'slack:expired-1',
        'discord:expired-2',
        'telegram:expired-3',
      );
    });
  });

  describe('remove', () => {
    it('should remove the entry from Redis hash', async () => {
      mockRedis.hdel.mockResolvedValue(1);

      await queue.remove('slack', 'app-123');

      expect(mockRedis.hdel).toHaveBeenCalledWith('bot:gateway:connect_queue', 'slack:app-123');
    });

    it('should do nothing when Redis is not available', async () => {
      vi.mocked(getAgentRuntimeRedisClient).mockReturnValueOnce(null);

      await queue.remove('slack', 'app-123');

      expect(mockRedis.hdel).not.toHaveBeenCalled();
    });

    it('should use platform:applicationId as the hash field', async () => {
      mockRedis.hdel.mockResolvedValue(1);

      await queue.remove('telegram', 'bot-999');

      expect(mockRedis.hdel).toHaveBeenCalledWith('bot:gateway:connect_queue', 'telegram:bot-999');
    });
  });
});
