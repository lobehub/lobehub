// @vitest-environment node
// NOTICE: here due to the reason we are using [`happy-dom`](https://github.com/lobehub/lobe-chat/blob/13753145557a9dede98b1f5489f93ac570ef2956/vitest.config.mts#L45)
// for Vitest environment, and in fact that this is a known bug for happy-dom not including
// Authorization header in fetch requests.
//
// Read more here: https://github.com/capricorn86/happy-dom/issues/1042#issuecomment-3585851354
import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UpstashConfig } from './types';

const buildUpstashConfig = (): UpstashConfig | null => {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) return null;

  return {
    enabled: true,
    prefix: process.env.REDIS_PREFIX ?? 'lobe-chat-test',
    provider: 'upstash',
    token,
    url,
  };
};

const loadUpstashProvider = async () => (await import('./upstash')).UpstashRedisProvider;

const createMockedProvider = async () => {
  const mocks = {
    mockSet: vi.fn().mockResolvedValue('OK'),
    mockGet: vi.fn().mockResolvedValue('mock-value'),
    mockDel: vi.fn().mockResolvedValue(1),
    mockSetex: vi.fn().mockResolvedValue('OK'),
    mockMset: vi.fn().mockResolvedValue('OK'),
    mockHset: vi.fn().mockResolvedValue(1),
    mockHdel: vi.fn().mockResolvedValue(1),
    mockHgetall: vi.fn().mockResolvedValue({ a: '1' }),
    mockPing: vi.fn().mockResolvedValue('PONG'),
    mockExists: vi.fn().mockResolvedValue(1),
    mockExpire: vi.fn().mockResolvedValue(1),
    mockTtl: vi.fn().mockResolvedValue(50),
    mockIncr: vi.fn().mockResolvedValue(2),
    mockDecr: vi.fn().mockResolvedValue(0),
    mockMget: vi.fn().mockResolvedValue(['a', 'b']),
    mockHget: vi.fn().mockResolvedValue('field'),
  };

  vi.resetModules();
  vi.doMock('@upstash/redis', () => {
    class FakeRedis {
      constructor(public config: any) {}
      ping = mocks.mockPing;
      set = mocks.mockSet;
      get = mocks.mockGet;
      del = mocks.mockDel;
      setex = mocks.mockSetex;
      exists = mocks.mockExists;
      expire = mocks.mockExpire;
      ttl = mocks.mockTtl;
      incr = mocks.mockIncr;
      decr = mocks.mockDecr;
      mget = mocks.mockMget;
      mset = mocks.mockMset;
      hget = mocks.mockHget;
      hset = mocks.mockHset;
      hdel = mocks.mockHdel;
      hgetall = mocks.mockHgetall;
    }

    return { Redis: FakeRedis };
  });

  const UpstashRedisProvider = await loadUpstashProvider();
  const provider = new UpstashRedisProvider({
    enabled: true,
    prefix: 'mock',
    provider: 'upstash',
    token: 'token',
    url: 'https://example.upstash.io',
  });

  await provider.initialize();

  return { mocks, provider };
};

const shouldSkipIntegration = (error: unknown) =>
  error instanceof Error &&
  ['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN', 'Connection is closed'].some((msg) =>
    error.message.includes(msg),
  );

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.unmock('@upstash/redis');
});

describe('integrated', (test) => {
  const config = buildUpstashConfig();
  if (!config) {
    test.skip('UPSTASH_REDIS_REST_URL/TOKEN not provided; skip integrated upstash tests');
    return;
  }

  it('set -> get -> del roundtrip', async () => {
    vi.unmock('@upstash/redis');
    vi.resetModules();

    const UpstashRedisProvider = await loadUpstashProvider();
    const provider = new UpstashRedisProvider(config);
    try {
      await provider.initialize();

      const key = `upstash:test:${Date.now()}`;
      await provider.set(key, 'value', { ex: 60 });
      expect(await provider.get(key)).toBe('value');
      expect(await provider.del(key)).toBe(1);
    } catch (error) {
      if (shouldSkipIntegration(error)) {
        // Remote Upstash Redis unavailable in current environment; treat as skipped.
        return;
      }

      throw error;
    } finally {
      await provider.disconnect();
    }
  });
});

describe('mocked', () => {
  it('normalizes buffer keys to strings', async () => {
    const { mocks, provider } = await createMockedProvider();

    const bufKey = Buffer.from('buffer-key');
    await provider.set(bufKey, 'value');
    await provider.hset(bufKey, 'field', 'value');
    await provider.del(bufKey);

    expect(mocks.mockSet).toHaveBeenCalledWith('mock:buffer-key', 'value', undefined);
    expect(mocks.mockHset).toHaveBeenCalledWith('mock:buffer-key', { field: 'value' });
    expect(mocks.mockDel).toHaveBeenCalledWith('mock:buffer-key');
  });

  it('passes set options through to upstash client', async () => {
    const { mocks, provider } = await createMockedProvider();

    await provider.set('key', 'value', { ex: 10, nx: true, get: true });

    expect(mocks.mockSet).toHaveBeenCalledWith('mock:key', 'value', {
      ex: 10,
      nx: true,
      get: true,
    });
  });
});
