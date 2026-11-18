import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getRewrittenUrl,
  unstable_getResponseFromNextConfig,
} from 'next/experimental/testing/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { defineConfig } from './define-config';

describe('defineConfig', () => {
  const originalAssetBaseUrl = process.env.ASSET_BASE_URL;
  const originalLegacyPrefix = process.env.NEXT_PUBLIC_ASSET_PREFIX;

  afterEach(() => {
    vi.unstubAllEnvs();
    if (originalAssetBaseUrl === undefined) delete process.env.ASSET_BASE_URL;
    else process.env.ASSET_BASE_URL = originalAssetBaseUrl;

    if (originalLegacyPrefix === undefined) delete process.env.NEXT_PUBLIC_ASSET_PREFIX;
    else process.env.NEXT_PUBLIC_ASSET_PREFIX = originalLegacyPrefix;
  });

  describe('deployment file tracing', () => {
    it.each([false, true])(
      'keeps required worker files when a deployment adds tracing rules (standalone: %s)',
      (standalone) => {
        vi.stubEnv('DOCKER', 'false');
        vi.stubEnv('NEXT_BUILD_STANDALONE', standalone ? '1' : '0');
        const required = defineConfig({}).outputFileTracingIncludes!['*'];
        const config = defineConfig({
          outputFileTracingIncludes: {
            '*': ['deployment-assets/**/*'],
            '/api/custom': ['custom-assets/**/*'],
          },
        });

        expect(config.outputFileTracingIncludes!['*']).toEqual([
          ...required,
          'deployment-assets/**/*',
        ]);
        expect(config.outputFileTracingIncludes!['/api/custom']).toEqual(['custom-assets/**/*']);
      },
    );

    it('keeps the shared worker rule when a deployment only adds a route-specific rule', () => {
      const required = defineConfig({}).outputFileTracingIncludes!['*'];
      const config = defineConfig({
        outputFileTracingIncludes: { '/api/custom': ['custom-assets/**/*'] },
      });

      expect(config.outputFileTracingIncludes!['*']).toEqual(required);
    });
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

  describe('framing with CSP enabled', () => {
    const originalCSP = process.env.ENABLED_CSP;

    afterEach(() => {
      if (originalCSP === undefined) delete process.env.ENABLED_CSP;
      else process.env.ENABLED_CSP = originalCSP;
    });

    const framingHeadersOf = async (url: string) => {
      process.env.ENABLED_CSP = '1';
      const response = await unstable_getResponseFromNextConfig({
        nextConfig: defineConfig({}),
        url,
      });

      return {
        csp: response.headers.get('content-security-policy'),
        xfo: response.headers.get('x-frame-options'),
      };
    };

    it('denies framing on every app route, including the root', async () => {
      for (const url of [
        'https://app.example.com/',
        'https://app.example.com/settings/profile',
        'https://app.example.com/a/my-bot/chat',
        'https://app.example.com/embed',
        'https://app.example.com/embed/other',
      ]) {
        expect(await framingHeadersOf(url), url).toEqual({
          csp: "frame-ancestors 'none';",
          xfo: 'DENY',
        });
      }
    });

    // The proxy sets the per-share allowlist; a static DENY here would override it.
    it('leaves the Agent Share embed page to the proxy', async () => {
      expect(await framingHeadersOf('https://app.example.com/embed/agent/my-bot')).toEqual({
        csp: null,
        xfo: null,
      });
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
