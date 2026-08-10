import { describe, expect, it } from 'vitest';

import { defineConfig } from './define-config';

describe('defineConfig', () => {
  it('disables Next.js agent rule injection', () => {
    expect(defineConfig({}).agentRules).toBe(false);
  });

  it('caches SPA and auth build artifacts', async () => {
    const headers = await defineConfig({}).headers?.();

    for (const source of ['/_spa/:path*', '/_spa-auth/:path*']) {
      expect(headers?.find((header) => header.source === source)?.headers).toContainEqual({
        key: 'Cache-Control',
        value:
          'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800, stale-if-error=86400, immutable',
      });
    }
  });
});
