import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  initializeRedis,
  RedisManager,
  resetPrefixedRedisClient,
  resetRedisClient,
  tryInitializeRedisWithPrefix,
} from './manager';
import { type RedisConfig } from './types';

const { mockIoRedisInitialize, mockIoRedisDisconnect } = vi.hoisted(() => ({
  mockIoRedisInitialize: vi.fn().mockResolvedValue(undefined),
  mockIoRedisDisconnect: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./redis', () => {
  const IoRedisRedisProvider = vi.fn(function (config: unknown) {
    return {
      config,
      initialize: mockIoRedisInitialize,
      disconnect: mockIoRedisDisconnect,
    };
  });

  return { IoRedisRedisProvider };
});

afterEach(async () => {
  await RedisManager.reset();
  vi.clearAllMocks();
});

describe('RedisManager', () => {
  it('returns null when redis is disabled', async () => {
    const config = {
      enabled: false,
      prefix: 'test',
      tls: false,
      url: '',
    } satisfies RedisConfig;

    const instance = await initializeRedis(config);

    expect(instance).toBeNull();
    expect(mockIoRedisInitialize).not.toHaveBeenCalled();
  });

  it('initializes ioredis provider once and memoizes the instance', async () => {
    const config = {
      database: 0,
      enabled: true,
      password: 'pwd',
      prefix: 'test',
      tls: false,
      url: 'redis://localhost:6379',
      username: 'user',
    } satisfies RedisConfig;

    const [first, second] = await Promise.all([initializeRedis(config), initializeRedis(config)]);

    expect(first).toBe(second);
    expect(mockIoRedisInitialize).toHaveBeenCalledTimes(1);
  });

  it('disconnects existing provider on reset', async () => {
    const config = {
      enabled: true,
      prefix: 'test',
      tls: false,
      url: 'redis://localhost:6379',
    } satisfies RedisConfig;

    await initializeRedis(config);
    await resetRedisClient();

    expect(mockIoRedisDisconnect).toHaveBeenCalledTimes(1);
  });
});

describe('tryInitializeRedisWithPrefix', () => {
  const config = {
    enabled: true,
    prefix: 'test',
    tls: false,
    url: 'redis://localhost:6379',
  } satisfies RedisConfig;

  afterEach(async () => {
    await resetPrefixedRedisClient();
  });

  it('returns null instead of throwing when the connection fails, then retries', async () => {
    mockIoRedisInitialize.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(tryInitializeRedisWithPrefix(config, 'cache')).resolves.toBeNull();

    // The failed setup is dropped, so the next caller gets a live provider.
    const provider = await tryInitializeRedisWithPrefix(config, 'cache');
    expect(provider).not.toBeNull();
    expect(mockIoRedisInitialize).toHaveBeenCalledTimes(2);
  });

  it('returns null when redis is disabled', async () => {
    await expect(
      tryInitializeRedisWithPrefix({ ...config, enabled: false, url: '' }, 'cache'),
    ).resolves.toBeNull();
    expect(mockIoRedisInitialize).not.toHaveBeenCalled();
  });
});
