// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { RedisRuntimeConfigProvider } from './RedisRuntimeConfigProvider';

const getRedisConfigMock = vi.fn();
const initializeRedisMock = vi.fn();

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
});
