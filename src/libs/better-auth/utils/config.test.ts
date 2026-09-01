import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('@/libs/redis', () => ({
  initializeRedis: vi.fn(),
  isRedisEnabled: vi.fn(() => false),
}));
vi.mock('@/utils/env', () => ({ isDev: false }));

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
