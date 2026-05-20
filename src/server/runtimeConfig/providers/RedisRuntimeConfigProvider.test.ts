// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { RedisRuntimeConfigProvider } from './RedisRuntimeConfigProvider';

const { getRedisConfigMock, initializeRedisMock } = vi.hoisted(() => ({
  getRedisConfigMock: vi.fn(),
  initializeRedisMock: vi.fn(),
}));

vi.mock('@/envs/redis', () => ({
  getRedisConfig: getRedisConfigMock,
}));

vi.mock('@/libs/redis', () => ({
  initializeRedis: initializeRedisMock,
}));

const testDomain = {
  cacheTtlMs: 5000,
  getStorageKey: () => 'runtime-config:test:published',
  key: 'test',
  schema: z.object({ enabled: z.boolean() }),
};

describe('RedisRuntimeConfigProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('should return parsed snapshot data from versioned envelope', async () => {
    getRedisConfigMock.mockReturnValue({ enabled: true });
    initializeRedisMock.mockResolvedValue({
      get: vi.fn().mockResolvedValue(
        JSON.stringify({
          data: { enabled: true },
          updatedAt: '2026-04-23T00:00:00.000Z',
          version: 12,
        }),
      ),
    });

    const provider = new RedisRuntimeConfigProvider(testDomain);
    const snapshot = await provider.getSnapshot({ scope: 'global' });

    expect(snapshot).toEqual({
      data: { enabled: true },
      updatedAt: '2026-04-23T00:00:00.000Z',
      version: 12,
    });
  });

  it('should return null when redis is disabled', async () => {
    getRedisConfigMock.mockReturnValue({ enabled: false });

    const provider = new RedisRuntimeConfigProvider(testDomain);

    expect(provider.isEnabled()).toBe(false);
  });

  it('should treat cached null snapshots as cache hits', async () => {
    const getMock = vi.fn().mockResolvedValue(null);

    getRedisConfigMock.mockReturnValue({ enabled: true });
    initializeRedisMock.mockResolvedValue({ get: getMock });

    const provider = new RedisRuntimeConfigProvider(testDomain);

    await expect(provider.getSnapshot({ scope: 'global' })).resolves.toBeNull();
    await expect(provider.getSnapshot({ scope: 'global' })).resolves.toBeNull();

    expect(initializeRedisMock).toHaveBeenCalledTimes(1);
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it('should proactively evict expired selector cache entries', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-23T00:00:00.000Z'));

    const getMock = vi.fn().mockResolvedValue(null);

    getRedisConfigMock.mockReturnValue({ enabled: true });
    initializeRedisMock.mockResolvedValue({ get: getMock });

    const provider = new RedisRuntimeConfigProvider(testDomain);

    await expect(provider.getSnapshot({ id: 'user-1', scope: 'user' })).resolves.toBeNull();
    expect((provider as any).cache.size).toBe(1);

    vi.setSystemTime(new Date('2026-04-23T00:00:06.000Z'));

    await expect(provider.getSnapshot({ id: 'user-2', scope: 'user' })).resolves.toBeNull();

    expect((provider as any).cache.has('user:user-1')).toBe(false);
    expect((provider as any).cache.has('user:user-2')).toBe(true);
    expect((provider as any).cache.size).toBe(1);
    expect(getMock).toHaveBeenCalledTimes(2);
  });
});
