import { afterEach, describe, expect, it, vi } from 'vitest';

import { type RedisConfig } from './types';

const buildRedisConfig = (): RedisConfig | null => {
  const url = process.env.REDIS_URL;

  if (!url) return null;

  const database = Number.parseInt(process.env.REDIS_DATABASE ?? '', 10);

  return {
    database: Number.isNaN(database) ? undefined : database,
    enabled: true,
    password: process.env.REDIS_PASSWORD,
    prefix: process.env.REDIS_PREFIX ?? 'lobe-chat-test',
    tls: process.env.REDIS_TLS === 'true',
    url,
    username: process.env.REDIS_USERNAME,
  };
};

const loadRedisProvider = async () => (await import('./redis')).IoRedisRedisProvider;

const createMockedProvider = async () => {
  const mocks = {
    connect: vi.fn().mockResolvedValue(undefined),
    ping: vi.fn().mockResolvedValue('PONG'),
    quit: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue('mock-value'),
    set: vi.fn().mockResolvedValue('OK'),
    setex: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    exists: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(50),
    incr: vi.fn().mockResolvedValue(2),
    decr: vi.fn().mockResolvedValue(0),
    mget: vi.fn().mockResolvedValue(['a', 'b']),
    mset: vi.fn().mockResolvedValue('OK'),
    hget: vi.fn().mockResolvedValue('field'),
    hset: vi.fn().mockResolvedValue(1),
    hdel: vi.fn().mockResolvedValue(1),
    hgetall: vi.fn().mockResolvedValue({ a: '1' }),
  };

  vi.resetModules();
  vi.doMock('ioredis', () => {
    class FakeRedis {
      constructor(
        public url: string,
        public options: any,
      ) {}
      connect = mocks.connect;
      ping = mocks.ping;
      quit = mocks.quit;
      get = mocks.get;
      set = mocks.set;
      setex = mocks.setex;
      del = mocks.del;
      exists = mocks.exists;
      expire = mocks.expire;
      ttl = mocks.ttl;
      incr = mocks.incr;
      decr = mocks.decr;
      mget = mocks.mget;
      mset = mocks.mset;
      hget = mocks.hget;
      hset = mocks.hset;
      hdel = mocks.hdel;
      hgetall = mocks.hgetall;
    }

    return { default: FakeRedis };
  });

  const IoRedisRedisProvider = await loadRedisProvider();
  const provider = new IoRedisRedisProvider({
    enabled: true,
    prefix: 'mock',
    tls: false,
    url: 'redis://localhost:6379',
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
  vi.unmock('ioredis');
});

describe('integrated', (test) => {
  const config = buildRedisConfig();
  if (!config) {
    test.skip('REDIS_URL not provided; skip integrated ioredis tests');
    return;
  }

  it('set -> get -> del roundtrip', async () => {
    vi.unmock('ioredis');
    vi.resetModules();

    const IoRedisRedisProvider = await loadRedisProvider();
    const provider = new IoRedisRedisProvider(config);
    try {
      await provider.initialize();

      const key = `redis:test:${Date.now()}`;
      await provider.set(key, 'value', { ex: 60 });
      expect(await provider.get(key)).toBe('value');
      expect(await provider.del(key)).toBe(1);
    } catch (error) {
      if (shouldSkipIntegration(error)) {
        // Remote Redis unavailable in current environment; treat as skipped.
        return;
      }

      throw error;
    } finally {
      await provider.disconnect();
    }
  });
});

describe('mocked', () => {
  it('normalizes set options into ioredis arguments', async () => {
    const { mocks, provider } = await createMockedProvider();
    await provider.set('key', 'value', { ex: 10, nx: true, get: true });

    expect(mocks.set).toHaveBeenCalledWith('key', 'value', 'EX', 10, 'NX', 'GET');
    await provider.disconnect();
  });

  it('supports buffer keys for hashes and strings', async () => {
    const { mocks, provider } = await createMockedProvider();

    const bufKey = Buffer.from('buffer-key');
    await provider.hset(bufKey, 'field', 'value');
    await provider.get(bufKey);

    expect(mocks.hset).toHaveBeenCalledWith(bufKey, 'field', 'value');
    expect(mocks.get).toHaveBeenCalledWith(bufKey);

    await provider.disconnect();
  });
});
