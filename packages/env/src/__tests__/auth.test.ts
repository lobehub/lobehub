// @vitest-environment node
import { readFile } from 'node:fs/promises';

import { afterEach, describe, expect, it, vi } from 'vitest';

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
    vi.stubEnv('AUTH_SECRET', authSecret);

    const { getAuthConfig } = await import('../auth');
    expect(getAuthConfig().AUTH_SECRET).toBe(authSecret);
  });

  it('rejects a production secret shorter than 32 characters', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_SECRET', 'use-for-build');

    await expect(import('../auth')).rejects.toThrow();
  });
});
