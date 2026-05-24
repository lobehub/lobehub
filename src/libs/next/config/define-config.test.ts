import { describe, expect, it, vi } from 'vitest';

vi.mock('code-inspector-plugin', () => ({
  codeInspectorPlugin: vi.fn(() => ({})),
}));

describe('defineConfig', () => {
  it('should treat zipfile as an optional server-native dependency', async () => {
    const { defineConfig } = await import('./define-config');

    const config = defineConfig({});

    expect(config.serverExternalPackages).toContain('zipfile');

    const resolvedWebpackConfig = config.webpack?.(
      {
        externals: undefined,
        module: {},
      } as any,
      {
        isServer: true,
      } as any,
    ) as any;

    const externals = Array.isArray(resolvedWebpackConfig.externals)
      ? resolvedWebpackConfig.externals
      : [resolvedWebpackConfig.externals];

    expect(externals).toContainEqual(
      expect.objectContaining({
        zipfile: 'commonjs zipfile',
      }),
    );
  });
});
