import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authEnv: { AUTH_COOKIE_PREFIX: undefined as string | undefined },
  defineConfig: vi.fn((config: unknown) => config),
}));

vi.mock('@/envs/auth', () => ({
  authEnv: mocks.authEnv,
}));

vi.mock('@/libs/better-auth/define-config', () => ({
  defineConfig: mocks.defineConfig,
}));

vi.unmock('@/auth');

describe('auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.authEnv.AUTH_COOKIE_PREFIX = undefined;
  });

  it('keeps Better Auth default cookie prefix when no override is configured', async () => {
    await import('./auth');

    expect(mocks.defineConfig).toHaveBeenCalledWith({ plugins: [] });
  });

  it('uses the configured Better Auth cookie prefix', async () => {
    mocks.authEnv.AUTH_COOKIE_PREFIX = 'lobehub-oss';

    await import('./auth');

    expect(mocks.defineConfig).toHaveBeenCalledWith({
      cookiePrefix: 'lobehub-oss',
      plugins: [],
    });
  });
});
