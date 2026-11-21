import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initializeRedis, isRedisEnabled } from '@/server/modules/Redis';

const mocks = vi.hoisted(() => ({
  appEnv: { APP_URL: 'https://app.example.com' },
  authEnv: {
    AUTH_ADDITIONAL_TRUSTED_ORIGINS: undefined as string | undefined,
    AUTH_TRUSTED_ORIGINS: undefined as string | undefined,
  },
}));

vi.mock('@/envs/app', () => ({ appEnv: mocks.appEnv }));
vi.mock('@/envs/auth', () => ({ authEnv: mocks.authEnv }));
vi.mock('@/envs/redis', () => ({ getRedisConfig: vi.fn() }));
vi.mock('@/server/modules/Redis', () => ({
  initializeRedis: vi.fn(),
  isRedisEnabled: vi.fn(() => false),
}));
vi.mock('@/utils/env', () => ({ isDev: false }));

describe('createSecondaryStorage', () => {
  const redis = {
    del: vi.fn(),
    eval: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isRedisEnabled).mockReturnValue(true);
    vi.mocked(initializeRedis).mockResolvedValue(redis as any);
  });

  afterEach(() => {
    vi.mocked(isRedisEnabled).mockReturnValue(false);
  });

  it('does not configure secondary storage when Redis is disabled', async () => {
    vi.mocked(isRedisEnabled).mockReturnValue(false);
    const { createSecondaryStorage } = await import('./config');

    expect(createSecondaryStorage()).toBeUndefined();
    expect(initializeRedis).not.toHaveBeenCalled();
  });

  it('consumes a namespaced value in one atomic operation', async () => {
    const { createSecondaryStorage } = await import('./config');
    const storage = createSecondaryStorage()!;
    redis.eval.mockResolvedValueOnce('one-time-value').mockResolvedValueOnce(null);

    expect(await storage.getAndDelete!('verification-token')).toBe('one-time-value');
    expect(await storage.getAndDelete!('verification-token')).toBeNull();

    const [script, keys, key] = redis.eval.mock.calls[0];
    expect(script).toContain("redis.call('GET', KEYS[1])");
    expect(script).toContain("redis.call('DEL', KEYS[1])");
    expect(keys).toBe(1);
    expect(key).toBe('better-auth:verification-token');
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('increments atomically and only sets the counter TTL on creation', async () => {
    const { createSecondaryStorage } = await import('./config');
    const storage = createSecondaryStorage()!;
    redis.eval.mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    expect(await storage.increment!('rate-limit', 60)).toBe(1);
    expect(await storage.increment!('rate-limit', 60)).toBe(2);

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("if value == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end"),
      1,
      'better-auth:rate-limit',
      60,
    );
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('fails closed when the enabled Redis client cannot initialize', async () => {
    vi.mocked(initializeRedis).mockResolvedValue(null);
    const { createSecondaryStorage } = await import('./config');
    const storage = createSecondaryStorage()!;

    await expect(storage.getAndDelete!('token')).rejects.toThrow('failed to initialize');
    await expect(storage.increment!('counter', 60)).rejects.toThrow('failed to initialize');
    expect(redis.eval).not.toHaveBeenCalled();
  });
});

describe('getTrustedOrigins', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    mocks.appEnv.APP_URL = 'https://app.example.com';
    mocks.authEnv.AUTH_ADDITIONAL_TRUSTED_ORIGINS = undefined;
    mocks.authEnv.AUTH_TRUSTED_ORIGINS = undefined;
    process.env = { ...originalEnv };
    delete process.env.VERCEL_BRANCH_URL;
    delete process.env.VERCEL_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should append normalized origins to provider-aware defaults', async () => {
    mocks.authEnv.AUTH_ADDITIONAL_TRUSTED_ORIGINS = [
      'https://gateway.example.com/signin',
      'gateway.example.com/another-path',
    ].join(',');
    const { getTrustedOrigins } = await import('./config');

    expect(getTrustedOrigins(['apple'])).toEqual([
      'https://app.example.com',
      'com.lobehub.app://',
      'https://appleid.apple.com',
      'https://gateway.example.com',
    ]);
  });

  it('should append origins without changing override semantics', async () => {
    mocks.authEnv.AUTH_TRUSTED_ORIGINS = 'https://override.example.com/callback';
    mocks.authEnv.AUTH_ADDITIONAL_TRUSTED_ORIGINS = 'https://gateway.example.com/signin';
    const { getTrustedOrigins } = await import('./config');

    expect(getTrustedOrigins(['apple'])).toEqual([
      'https://override.example.com',
      'https://gateway.example.com',
    ]);
  });
});

describe('getPasskeyOrigins', () => {
  beforeEach(() => {
    mocks.appEnv.APP_URL = 'https://app.example.com';
  });

  it('should trust the web app and Android certificates authorized for login credentials', async () => {
    const { getPasskeyOrigins } = await import('./config');

    expect(getPasskeyOrigins()).toEqual([
      'https://app.example.com',
      'android:apk-key-hash:11Tbo3jVi48gAe17mxjTsFvRIqqXK1nhpo4xJCFEDSs',
      'android:apk-key-hash:-sYXRdwJA3hvue3mKpYrOZ9zSPC7b4mbgzJmdZEDO5w',
      'android:apk-key-hash:GyE4XXJAZfUWIB3J0msEY8Mz8ZeragZmDj7wfmCCfuc',
      'android:apk-key-hash:G77UoK5DVuVYAXTEuaALDlq5Xg-pwGUYaM8fqj6PT9s',
    ]);
  });

  it('should preserve inferred origins when the web app URL is unavailable', async () => {
    mocks.appEnv.APP_URL = '';
    const { getPasskeyOrigins } = await import('./config');

    expect(getPasskeyOrigins()).toBeUndefined();
  });
});
