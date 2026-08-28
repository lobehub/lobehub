// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
