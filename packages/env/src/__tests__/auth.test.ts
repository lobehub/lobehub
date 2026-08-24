// @vitest-environment node
import { readFile } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('AUTH_SECRET production validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('keeps the Docker builder placeholder compatible with the production minimum', async () => {
    const dockerfile = await readFile(new URL('../../../../Dockerfile', import.meta.url), 'utf8');
    const authSecret = dockerfile.match(/AUTH_SECRET="([^"]+)"/)?.[1];

    expect(authSecret).toBeDefined();
    expect(authSecret).toHaveLength(32);

    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DATABASE_URL', 'postgres://localhost/lobehub');
    vi.stubEnv('NEXT_PUBLIC_IS_DESKTOP_APP', undefined);
    vi.stubEnv('AUTH_SECRET', authSecret);

    const { getAuthConfig } = await import('../auth');
    expect(getAuthConfig().AUTH_SECRET).toBe(authSecret);
  });

  it('rejects a server-database production secret shorter than 32 characters', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DATABASE_URL', 'postgres://localhost/lobehub');
    vi.stubEnv('NEXT_PUBLIC_IS_DESKTOP_APP', undefined);
    vi.stubEnv('AUTH_SECRET', 'use-for-build');

    await expect(import('../auth')).rejects.toThrow();
  });

  it('rejects a missing server-database production secret', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DATABASE_URL', 'postgres://localhost/lobehub');
    vi.stubEnv('NEXT_PUBLIC_IS_DESKTOP_APP', undefined);
    vi.stubEnv('AUTH_SECRET', undefined);

    await expect(import('../auth')).rejects.toThrow();
  });

  it.each([
    {
      databaseUrl: undefined,
      desktop: undefined,
      mode: 'without a server database',
    },
    {
      databaseUrl: 'postgres://localhost/lobehub',
      desktop: '1',
      mode: 'for desktop',
    },
  ])('allows a missing production secret $mode', async ({ databaseUrl, desktop }) => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DATABASE_URL', databaseUrl);
    vi.stubEnv('NEXT_PUBLIC_IS_DESKTOP_APP', desktop);
    vi.stubEnv('AUTH_SECRET', undefined);

    const { getAuthConfig } = await import('../auth');
    expect(getAuthConfig().AUTH_SECRET).toBeUndefined();
  });
});

describe('getAuthConfig', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should expose a custom Better Auth cookie prefix', async () => {
    vi.stubEnv('AUTH_COOKIE_PREFIX', 'lobehub-oss');

    const { getAuthConfig } = await import('../auth');

    expect(getAuthConfig().AUTH_COOKIE_PREFIX).toBe('lobehub-oss');
  });
});
