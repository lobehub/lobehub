import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from 'next/constants';
import {
  getRewrittenUrl,
  unstable_getResponseFromNextConfig,
} from 'next/experimental/testing/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { assertRequiredBuildArtifacts, defineConfig } from './define-config';

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

  describe('required build artifacts', () => {
    let projectRoot: string;

    const writeWorker = (root: string) => {
      mkdirSync(path.join(root, 'dist/file-parse-worker'), { recursive: true });
      writeFileSync(path.join(root, 'dist/file-parse-worker/fileParseWorker.mjs'), '');
    };

    beforeEach(() => {
      projectRoot = mkdtempSync(path.join(tmpdir(), 'define-config-'));
    });

    afterEach(() => {
      vi.restoreAllMocks();
      rmSync(projectRoot, { force: true, recursive: true });
    });

    it('passes a production build when the worker artifact exists at the project root', () => {
      writeWorker(projectRoot);

      expect(() =>
        assertRequiredBuildArtifacts({ phase: PHASE_PRODUCTION_BUILD, projectRoot }),
      ).not.toThrow();
    });

    it('fails a production build when the worker artifact is missing', () => {
      expect(() =>
        assertRequiredBuildArtifacts({ phase: PHASE_PRODUCTION_BUILD, projectRoot }),
      ).toThrow(/dist\/file-parse-worker\/\*\*\/\*.*build:file-parse-worker/);
    });

    it('fails when the artifact exists only in a nested checkout, not the project root', () => {
      // Cloud builds from its own root; `lobehub/dist/...` from the submodule is never deployed.
      writeWorker(path.join(projectRoot, 'lobehub'));

      expect(() =>
        assertRequiredBuildArtifacts({ phase: PHASE_PRODUCTION_BUILD, projectRoot }),
      ).toThrow(/build:file-parse-worker/);
    });

    it('skips the check outside a production build', () => {
      expect(() =>
        assertRequiredBuildArtifacts({ phase: PHASE_DEVELOPMENT_SERVER, projectRoot }),
      ).not.toThrow();
      expect(() => assertRequiredBuildArtifacts({ phase: undefined, projectRoot })).not.toThrow();
    });

    it('runs the check when config loads for `next build`', () => {
      vi.spyOn(process, 'cwd').mockReturnValue(projectRoot);
      const argv = process.argv;
      process.argv = ['node', '/repo/node_modules/next/dist/bin/next', 'build'];

      try {
        expect(() => defineConfig({})).toThrow(/build:file-parse-worker/);
      } finally {
        process.argv = argv;
      }
    });
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
