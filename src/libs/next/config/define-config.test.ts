import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getRewrittenUrl,
  unstable_getResponseFromNextConfig,
} from 'next/experimental/testing/server';
import { afterEach, describe, expect, it } from 'vitest';

import { defineConfig } from './define-config';

describe('defineConfig', () => {
  const originalAssetBaseUrl = process.env.ASSET_BASE_URL;
  const originalLegacyPrefix = process.env.NEXT_PUBLIC_ASSET_PREFIX;

  afterEach(() => {
    if (originalAssetBaseUrl === undefined) delete process.env.ASSET_BASE_URL;
    else process.env.ASSET_BASE_URL = originalAssetBaseUrl;

    if (originalLegacyPrefix === undefined) delete process.env.NEXT_PUBLIC_ASSET_PREFIX;
    else process.env.NEXT_PUBLIC_ASSET_PREFIX = originalLegacyPrefix;
  });

  it('keeps an old image URL working after its static file moves, preserving the query', async () => {
    const response = await unstable_getResponseFromNextConfig({
      nextConfig: defineConfig({}),
      url: 'https://app.example.com/app-images/agent-artwork-styles/line-art-reference.webp?v=2',
    });
    const rewritten = new URL(getRewrittenUrl(response)!);

    expect(rewritten.pathname).toBe(
      '/static/app-images/agent-artwork-styles/line-art-reference.webp',
    );
    expect(rewritten.search).toBe('?v=2');
    const bytes = readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../../../public',
        rewritten.pathname.slice(1),
      ),
    );
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
    expect(bytes.toString('ascii', 8, 12)).toBe('WEBP');
  });

  describe('headers', () => {
    // Agent Share visitor pages (`/agent/:slugOrId`) are link-visible private
    // content: the route-scoped noindex must come AFTER the global
    // `x-robots-tag: all` rule so it overrides it for that path.
    it('marks /agent/* noindex, overriding the global x-robots-tag', async () => {
      const config = defineConfig({});
      const rules = await config.headers!();

      const globalIndex = rules.findIndex((rule) => rule.source === '/:path*');
      const agentIndex = rules.findIndex((rule) => rule.source === '/agent/:path*');

      expect(globalIndex).toBeGreaterThanOrEqual(0);
      expect(agentIndex).toBeGreaterThan(globalIndex);
      expect(rules[agentIndex].headers).toEqual([
        { key: 'x-robots-tag', value: 'noindex, nofollow' },
      ]);
    });
  });

  it('disables Next.js agent rule injection', () => {
    expect(defineConfig({}).agentRules).toBe(false);
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
