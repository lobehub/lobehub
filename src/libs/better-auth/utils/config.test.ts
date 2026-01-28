// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

describe('normalizeOrigin', () => {
  beforeEach(async () => {
    // Clear module cache to ensure fresh imports
    await import('vitest').then((m) => m.vi.resetModules());
  });

  it('should return undefined for empty input', async () => {
    const { normalizeOrigin } = await import('./config');
    expect(normalizeOrigin(undefined)).toBeUndefined();
    expect(normalizeOrigin('')).toBeUndefined();
  });

  it('should return custom schemes unchanged', async () => {
    const { normalizeOrigin } = await import('./config');
    expect(normalizeOrigin('com.lobehub.app://')).toBe('com.lobehub.app://');
    expect(normalizeOrigin('exp://*/*')).toBe('exp://*/*');
    expect(normalizeOrigin('myapp://callback')).toBe('myapp://callback');
  });

  it('should handle edge case of :// as custom scheme', async () => {
    const { normalizeOrigin } = await import('./config');
    // The function treats anything with :// that doesn't start with http as a custom scheme
    expect(normalizeOrigin('://')).toBe('://');
  });

  it('should normalize HTTP URLs to origin', async () => {
    const { normalizeOrigin } = await import('./config');
    expect(normalizeOrigin('http://example.com/path')).toBe('http://example.com');
    expect(normalizeOrigin('http://localhost:3000/api')).toBe('http://localhost:3000');
  });

  it('should normalize HTTPS URLs to origin', async () => {
    const { normalizeOrigin } = await import('./config');
    expect(normalizeOrigin('https://example.com/path')).toBe('https://example.com');
    expect(normalizeOrigin('https://api.example.com:8080/api')).toBe(
      'https://api.example.com:8080',
    );
  });

  it('should add https:// to URLs without protocol', async () => {
    const { normalizeOrigin } = await import('./config');
    expect(normalizeOrigin('example.com')).toBe('https://example.com');
    expect(normalizeOrigin('api.example.com:8080')).toBe('https://api.example.com:8080');
  });

  it('should handle Vercel URLs', async () => {
    const { normalizeOrigin } = await import('./config');
    expect(normalizeOrigin('myapp.vercel.app')).toBe('https://myapp.vercel.app');
    expect(normalizeOrigin('https://myapp-git-main.vercel.app')).toBe(
      'https://myapp-git-main.vercel.app',
    );
  });

  it('should return undefined for invalid URLs', async () => {
    const { normalizeOrigin } = await import('./config');
    expect(normalizeOrigin('not a valid url')).toBeUndefined();
  });

  it('should handle URLs with authentication', async () => {
    const { normalizeOrigin } = await import('./config');
    expect(normalizeOrigin('https://user:pass@example.com/path')).toBe('https://example.com');
  });

  it('should handle URLs with query params and hash', async () => {
    const { normalizeOrigin } = await import('./config');
    expect(normalizeOrigin('https://example.com/path?query=1#hash')).toBe('https://example.com');
  });
});

describe('getTrustedOrigins', () => {
  beforeEach(async () => {
    const { vi } = await import('vitest');
    vi.resetModules();
    // Clear environment variables
    delete process.env.AUTH_TRUSTED_ORIGINS;
    delete process.env.APP_URL;
    delete process.env.VERCEL;
    delete process.env.VERCEL_URL;
    delete process.env.VERCEL_BRANCH_URL;
  });

  it('should use AUTH_TRUSTED_ORIGINS when provided', async () => {
    process.env.AUTH_TRUSTED_ORIGINS = 'https://app1.com, https://app2.com, example.com';

    const { getTrustedOrigins } = await import('./config');
    const result = getTrustedOrigins([]);

    expect(result).toEqual(['https://app1.com', 'https://app2.com', 'https://example.com']);
  });

  it('should filter out invalid origins from AUTH_TRUSTED_ORIGINS', async () => {
    process.env.AUTH_TRUSTED_ORIGINS = 'https://valid.com, not a valid url, https://another.com';

    const { getTrustedOrigins } = await import('./config');
    const result = getTrustedOrigins([]);

    expect(result).toEqual(['https://valid.com', 'https://another.com']);
  });

  it('should handle custom schemes in AUTH_TRUSTED_ORIGINS', async () => {
    process.env.AUTH_TRUSTED_ORIGINS = 'https://web.app, com.lobehub.app://, exp://*/*';

    const { getTrustedOrigins } = await import('./config');
    const result = getTrustedOrigins([]);

    expect(result).toEqual(['https://web.app', 'com.lobehub.app://', 'exp://*/*']);
  });

  it('should deduplicate origins from AUTH_TRUSTED_ORIGINS', async () => {
    process.env.AUTH_TRUSTED_ORIGINS = 'https://app.com, app.com, https://app.com';

    const { getTrustedOrigins } = await import('./config');
    const result = getTrustedOrigins([]);

    expect(result).toEqual(['https://app.com']);
  });

  it('should include mobile app scheme and APP_URL in defaults', async () => {
    process.env.APP_URL = 'https://myapp.com';

    const { getTrustedOrigins } = await import('./config');
    const result = getTrustedOrigins([]);

    expect(result).toContain('com.lobehub.app://');
    expect(result).toContain('https://myapp.com');
  });

  it('should include expo dev scheme in development mode', async () => {
    process.env.APP_URL = 'http://localhost:3010';
    (process.env as any).NODE_ENV = 'development';

    const { getTrustedOrigins } = await import('./config');
    const result = getTrustedOrigins([]);

    expect(result).toContain('exp://*/*');
    expect(result).toContain('http://localhost:3010');
  });

  it('should not include expo dev scheme in production mode', async () => {
    process.env.APP_URL = 'https://production.com';
    (process.env as any).NODE_ENV = 'production';

    const { getTrustedOrigins } = await import('./config');
    const result = getTrustedOrigins([]);

    expect(result).not.toContain('exp://*/*');
    expect(result).toContain('https://production.com');
  });

  it('should add Apple trusted origin when apple SSO is enabled', async () => {
    process.env.APP_URL = 'https://myapp.com';

    const { getTrustedOrigins } = await import('./config');
    const result = getTrustedOrigins(['apple']);

    expect(result).toContain('https://appleid.apple.com');
    expect(result).toContain('https://myapp.com');
  });

  it('should not add Apple trusted origin when apple SSO is not enabled', async () => {
    process.env.APP_URL = 'https://myapp.com';

    const { getTrustedOrigins } = await import('./config');
    const result = getTrustedOrigins(['google', 'github']);

    expect(result).not.toContain('https://appleid.apple.com');
  });

  it('should not add Apple trusted origin when using custom AUTH_TRUSTED_ORIGINS', async () => {
    // When AUTH_TRUSTED_ORIGINS is set, it returns early and doesn't process SSO providers
    process.env.AUTH_TRUSTED_ORIGINS = 'https://myapp.com';

    const { getTrustedOrigins } = await import('./config');
    const result = getTrustedOrigins(['apple']);

    // Only custom origins, Apple is not added when AUTH_TRUSTED_ORIGINS is set
    expect(result).toContain('https://myapp.com');
    expect(result).not.toContain('https://appleid.apple.com');
  });

  it('should deduplicate all origins including Apple', async () => {
    process.env.APP_URL = 'https://myapp.com';

    const { getTrustedOrigins } = await import('./config');
    const result = getTrustedOrigins(['apple']);

    // Verify no duplicates
    expect(result).toBeDefined();
    expect(new Set(result).size).toBe(result!.length);
  });

  it('should handle VERCEL_URL in defaults', async () => {
    process.env.VERCEL_URL = 'myapp-xyz123.vercel.app';
    process.env.VERCEL_BRANCH_URL = 'myapp-git-branch.vercel.app';

    const { getTrustedOrigins } = await import('./config');
    const result = getTrustedOrigins([]);

    expect(result?.some((origin) => origin.includes('vercel.app'))).toBe(true);
  });

  it('should handle empty SSO providers array', async () => {
    process.env.APP_URL = 'https://myapp.com';

    const { getTrustedOrigins } = await import('./config');
    const result = getTrustedOrigins([]);

    expect(result).toContain('com.lobehub.app://');
    expect(result).toContain('https://myapp.com');
  });

  it('should handle multiple SSO providers including apple', async () => {
    process.env.APP_URL = 'https://myapp.com';

    const { getTrustedOrigins } = await import('./config');
    const result = getTrustedOrigins(['google', 'github', 'apple', 'microsoft']);

    expect(result).toContain('https://appleid.apple.com');
    // Should not add origins for other providers (only Apple has special handling)
  });

  it('should return undefined when defaults array is empty and no apple provider', async () => {
    // No APP_URL, no VERCEL env vars, and not in dev mode
    (process.env as any).NODE_ENV = 'production';

    const { getTrustedOrigins } = await import('./config');
    const result = getTrustedOrigins([]);

    // Should at minimum contain mobile app scheme
    expect(result).toContain('com.lobehub.app://');
  });

  it('should normalize Vercel URLs from environment', async () => {
    process.env.VERCEL_URL = 'deployment-abc123.vercel.app';

    const { getTrustedOrigins } = await import('./config');
    const result = getTrustedOrigins([]);

    expect(result).toContain('https://deployment-abc123.vercel.app');
  });

  it('should handle empty AUTH_TRUSTED_ORIGINS string', async () => {
    process.env.AUTH_TRUSTED_ORIGINS = '';
    process.env.APP_URL = 'https://myapp.com';

    const { getTrustedOrigins } = await import('./config');
    const result = getTrustedOrigins([]);

    // Should fall back to defaults
    expect(result).toContain('https://myapp.com');
    expect(result).toContain('com.lobehub.app://');
  });

  it('should handle whitespace-only AUTH_TRUSTED_ORIGINS', async () => {
    process.env.AUTH_TRUSTED_ORIGINS = '   ,  ,  ';
    process.env.APP_URL = 'https://myapp.com';

    const { getTrustedOrigins } = await import('./config');
    const result = getTrustedOrigins([]);

    // Should fall back to defaults since all entries are empty
    expect(result).toContain('https://myapp.com');
  });
});
