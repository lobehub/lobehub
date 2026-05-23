import { describe, expect, it, vi } from 'vitest';

vi.mock('code-inspector-plugin', () => ({
  codeInspectorPlugin: vi.fn(() => ({})),
}));

describe('defineConfig', () => {
  it('should externalize epub2 so optional zipfile resolution stays at runtime', async () => {
    const { defineConfig } = await import('./define-config');

    const config = defineConfig({});

    expect(config.serverExternalPackages).toContain('epub2');
  });

  it('should rewrite sitemap xml endpoints to runtime route handlers', async () => {
    const { defineConfig } = await import('./define-config');

    const config = defineConfig({});
    const rewrites = await config.rewrites?.();

    expect(rewrites).toEqual(
      expect.arrayContaining([
        { destination: '/sitemap.xml', source: '/sitemap-index.xml' },
        { destination: '/sitemap/:id', source: '/sitemap/:id.xml' },
      ]),
    );
  });

  it('should prepend sitemap runtime rewrites before object-shaped custom rewrites', async () => {
    const { defineConfig } = await import('./define-config');

    const config = defineConfig({
      rewrites: async () => ({
        afterFiles: [{ destination: '/bar', source: '/foo' }],
        beforeFiles: [{ destination: '/qux', source: '/baz' }],
        fallback: [{ destination: '/fallback', source: '/legacy' }],
      }),
    });

    const rewrites = await config.rewrites?.();

    expect(rewrites).toEqual({
      afterFiles: [{ destination: '/bar', source: '/foo' }],
      beforeFiles: [
        { destination: '/sitemap.xml', source: '/sitemap-index.xml' },
        { destination: '/sitemap/:id', source: '/sitemap/:id.xml' },
        { destination: '/qux', source: '/baz' },
      ],
      fallback: [{ destination: '/fallback', source: '/legacy' }],
    });
  });
});
