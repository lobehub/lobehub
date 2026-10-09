import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as RedisModule from '@/server/modules/Redis';

const { mockGetRedisConfig, mockTryInitializeRedisWithPrefix } = vi.hoisted(() => ({
  mockGetRedisConfig: vi.fn(),
  mockTryInitializeRedisWithPrefix: vi.fn(),
}));

vi.mock('@/envs/redis', () => ({ getRedisConfig: mockGetRedisConfig }));

vi.mock('@/server/modules/Redis', async (importOriginal) => ({
  ...(await importOriginal<typeof RedisModule>()),
  tryInitializeRedisWithPrefix: mockTryInitializeRedisWithPrefix,
}));

const enabledConfig = {
  enabled: true,
  prefix: 'lobe',
  tls: false,
  url: 'redis://localhost:6379',
};

// `cooldownUntil` lives at module scope, so each test gets a fresh module.
const loadClient = async () => {
  vi.resetModules();
  return await import('./client');
};

beforeEach(() => {
  mockGetRedisConfig.mockReset();
  mockTryInitializeRedisWithPrefix.mockReset();
});

describe('getRedisServiceClient', () => {
  it('skips Redis entirely when it is disabled', async () => {
    mockGetRedisConfig.mockReturnValue({ enabled: false, prefix: 'lobe', tls: false, url: '' });
    const { getRedisServiceClient } = await loadClient();

    await expect(getRedisServiceClient()).resolves.toBeNull();
    expect(mockTryInitializeRedisWithPrefix).not.toHaveBeenCalled();
  });

  it('returns the shared client and asks for the bounded timeouts', async () => {
    const provider = { get: vi.fn().mockResolvedValue('value'), set: vi.fn() };
    mockGetRedisConfig.mockReturnValue(enabledConfig);
    mockTryInitializeRedisWithPrefix.mockResolvedValue(provider);
    const { getRedisServiceClient } = await loadClient();

    const client = await getRedisServiceClient();
    expect(client).not.toBeNull();
    await expect(client!.get('k')).resolves.toBe('value');

    expect(mockTryInitializeRedisWithPrefix).toHaveBeenCalledWith(
      expect.objectContaining({ commandTimeoutMs: 1000, connectTimeoutMs: 1000 }),
      'sendPathCache',
    );
  });

  it('opens the circuit after a failed acquisition so later sends do not retry', async () => {
    mockGetRedisConfig.mockReturnValue(enabledConfig);
    mockTryInitializeRedisWithPrefix.mockResolvedValue(null);
    const { getRedisServiceClient } = await loadClient();

    await expect(getRedisServiceClient()).resolves.toBeNull();
    await expect(getRedisServiceClient()).resolves.toBeNull();

    expect(mockTryInitializeRedisWithPrefix).toHaveBeenCalledTimes(1);
  });

  it('bounds the wait when acquisition never settles and opens the circuit', async () => {
    vi.useFakeTimers();
    try {
      mockGetRedisConfig.mockReturnValue(enabledConfig);
      mockTryInitializeRedisWithPrefix.mockReturnValue(new Promise(() => {}));
      const { getRedisServiceClient } = await loadClient();

      const pending = getRedisServiceClient();
      await vi.advanceTimersByTimeAsync(1500);
      await expect(pending).resolves.toBeNull();

      await expect(getRedisServiceClient()).resolves.toBeNull();
      expect(mockTryInitializeRedisWithPrefix).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens the circuit when a command on the memoized client fails', async () => {
    // Redis can go down after the provider is memoized; acquisition would keep
    // returning it, so the command failure itself must trip the cooldown.
    const provider = {
      get: vi.fn().mockRejectedValue(new Error('redis down')),
      set: vi.fn(),
    };
    mockGetRedisConfig.mockReturnValue(enabledConfig);
    mockTryInitializeRedisWithPrefix.mockResolvedValue(provider);
    const { getRedisServiceClient } = await loadClient();

    const client = await getRedisServiceClient();
    expect(client).not.toBeNull();
    await expect(client!.get('k')).rejects.toThrow('redis down');

    await expect(getRedisServiceClient()).resolves.toBeNull();
    expect(mockTryInitializeRedisWithPrefix).toHaveBeenCalledTimes(1);
  });
});
