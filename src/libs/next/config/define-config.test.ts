import { afterEach, describe, expect, it, vi } from 'vitest';

import { defineConfig } from './define-config';

describe('defineConfig', () => {
  const originalAssetBaseUrl = process.env.ASSET_BASE_URL;
  const originalLegacyPrefix = process.env.NEXT_PUBLIC_ASSET_PREFIX;

  afterEach(() => {
    if (originalAssetBaseUrl === undefined) delete process.env.ASSET_BASE_URL;
    else process.env.ASSET_BASE_URL = originalAssetBaseUrl;

    if (originalLegacyPrefix === undefined) delete process.env.NEXT_PUBLIC_ASSET_PREFIX;
    else process.env.NEXT_PUBLIC_ASSET_PREFIX = originalLegacyPrefix;

    vi.unstubAllEnvs();
  });

  it('disables Next.js agent rule injection', () => {
    expect(defineConfig({}).agentRules).toBe(false);
  });

  it('enables frame protections when ENABLED_CSP is unset', async () => {
    vi.stubEnv('ENABLED_CSP', undefined);

    const headers = await defineConfig({}).headers?.();
    const securityHeaders = headers?.find(({ source }) => source === '/:path*')?.headers;

    expect(securityHeaders).toEqual(
      expect.arrayContaining([
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none';" },
      ]),
    );
  });

  it('allows frame protections to be explicitly disabled', async () => {
    vi.stubEnv('ENABLED_CSP', '0');

    const headers = await defineConfig({}).headers?.();
    const securityHeaders = headers?.find(({ source }) => source === '/:path*')?.headers;
    const securityHeaderKeys = securityHeaders?.map(({ key }) => key);

    expect(securityHeaderKeys).not.toContain('X-Frame-Options');
    expect(securityHeaderKeys).not.toContain('Content-Security-Policy');
  });

  describe('crossOrigin', () => {
    it('stays unset when no asset prefix is configured', () => {
      delete process.env.ASSET_BASE_URL;
      delete process.env.NEXT_PUBLIC_ASSET_PREFIX;

      expect(defineConfig({}).crossOrigin).toBeUndefined();
    });

    it('is anonymous when ASSET_BASE_URL is set', () => {
      process.env.ASSET_BASE_URL = 'https://assets.example.com';
      delete process.env.NEXT_PUBLIC_ASSET_PREFIX;

      expect(defineConfig({}).crossOrigin).toBe('anonymous');
    });

    it('is anonymous when only the deprecated NEXT_PUBLIC_ASSET_PREFIX is set', () => {
      delete process.env.ASSET_BASE_URL;
      process.env.NEXT_PUBLIC_ASSET_PREFIX = 'https://legacy.example.com';

      expect(defineConfig({}).crossOrigin).toBe('anonymous');
    });
  });

  describe('assetPrefix', () => {
    it('is undefined when no env is set', () => {
      delete process.env.ASSET_BASE_URL;
      delete process.env.NEXT_PUBLIC_ASSET_PREFIX;

      expect(defineConfig({}).assetPrefix).toBeUndefined();
    });

    it('derives from ASSET_BASE_URL, stripping a trailing slash', () => {
      process.env.ASSET_BASE_URL = 'https://assets.example.com/';
      delete process.env.NEXT_PUBLIC_ASSET_PREFIX;

      expect(defineConfig({}).assetPrefix).toBe('https://assets.example.com');
    });

    it('falls back to the deprecated NEXT_PUBLIC_ASSET_PREFIX', () => {
      delete process.env.ASSET_BASE_URL;
      process.env.NEXT_PUBLIC_ASSET_PREFIX = 'https://legacy.example.com';

      expect(defineConfig({}).assetPrefix).toBe('https://legacy.example.com');
    });

    it('strips a trailing slash from the deprecated NEXT_PUBLIC_ASSET_PREFIX too', () => {
      delete process.env.ASSET_BASE_URL;
      process.env.NEXT_PUBLIC_ASSET_PREFIX = 'https://legacy.example.com/';

      expect(defineConfig({}).assetPrefix).toBe('https://legacy.example.com');
    });

    it('prefers ASSET_BASE_URL over the deprecated key', () => {
      process.env.ASSET_BASE_URL = 'https://assets.example.com';
      process.env.NEXT_PUBLIC_ASSET_PREFIX = 'https://legacy.example.com';

      expect(defineConfig({}).assetPrefix).toBe('https://assets.example.com');
    });
  });
});
