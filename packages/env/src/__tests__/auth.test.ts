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

  it('should expose additional trusted origins', async () => {
    vi.stubEnv('AUTH_ADDITIONAL_TRUSTED_ORIGINS', 'https://gateway.example.com');

    const { getAuthConfig } = await import('../auth');

    expect(getAuthConfig().AUTH_ADDITIONAL_TRUSTED_ORIGINS).toBe('https://gateway.example.com');
  });
  it.each(['15s', '1m', '90 seconds', '2h'])(
    'accepts INTERNAL_JWT_EXPIRATION %s',
    async (value) => {
      vi.stubEnv('INTERNAL_JWT_EXPIRATION', value);

      const { getAuthConfig } = await import('../auth');

      expect(getAuthConfig().INTERNAL_JWT_EXPIRATION).toBe(value);
    },
  );

  // jose's setExpirationTime throws on these, failing every internal JWT signature
  it.each(['15', '15 s ago', '-15s', 'soon'])(
    'rejects INTERNAL_JWT_EXPIRATION %s at load',
    async (value) => {
      vi.stubEnv('INTERNAL_JWT_EXPIRATION', value);
      vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(import('../auth')).rejects.toThrow(/Invalid environment variables/);
    },
  );
});
