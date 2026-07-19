import { describe, expect, it } from 'vitest';

import { __testing, sharedModulePreload, sharedOptimizeDeps } from './sharedRendererConfig';

describe('sharedOptimizeDeps', () => {
  it('pre-bundles the root and base-ui entrypoints together', () => {
    expect(sharedOptimizeDeps.include).toEqual(
      expect.arrayContaining(['@lobehub/ui', '@lobehub/ui/base-ui']),
    );
  });
});

describe('sharedModulePreload', () => {
  it('keeps vendor modulepreload dependencies while excluding i18n chunks', () => {
    const resolveDependencies = sharedModulePreload.resolveDependencies!;

    expect(
      resolveDependencies(
        'assets/index.js',
        [
          'assets/vendor-icons.js',
          'vendor/vendor-react.js',
          'i18n/i18n-default.js',
          'assets/i18n-en-US.js',
          'assets/page.js',
        ],
        { hostId: 'index.html', hostType: 'html' },
      ),
    ).toEqual(['assets/vendor-icons.js', 'vendor/vendor-react.js', 'assets/page.js']);
  });
});

describe('sharedManualChunks', () => {
  it('splits auth SPA namespaces into their own per-locale i18n chunks', () => {
    expect(__testing.sharedManualChunks('/repo/locales/zh-CN/auth.json')).toBe('i18n-zh-CN-auth');
    expect(__testing.sharedManualChunks('/repo/locales/zh-CN/common.json')).toBe(
      'i18n-zh-CN-common',
    );
    expect(__testing.sharedManualChunks('/repo/packages/locales/src/default/oauth.ts')).toBe(
      'i18n-default-oauth',
    );
    expect(__testing.sharedManualChunks('/repo/packages/locales/src/default/chat.ts')).toBe(
      'i18n-src',
    );
    expect(__testing.sharedManualChunks('/repo/locales/zh-CN/chat.json')).toBe('i18n-zh-CN');
    expect(__testing.sharedManualChunks('/repo/locales/zh-CN/models.json')).toBe(
      'i18n-zh-CN-models',
    );
  });

  it('keeps locale runtime helpers out of the default locale chunk', () => {
    expect(__testing.sharedManualChunks('/repo/packages/locales/src/resources.ts')).toBe(undefined);
    expect(__testing.sharedManualChunks('/repo/packages/locales/src/create.ts')).toBe(undefined);
  });

  it('groups shared constants into a dedicated chunk', () => {
    expect(__testing.sharedManualChunks('/repo/packages/const/src/url.ts')).toBe('app-const');
  });

  it('groups stable runtime packages into coarse vendor chunks', () => {
    expect(
      __testing.sharedManualChunks('/repo/node_modules/.pnpm/react@19/node_modules/react/index.js'),
    ).toBe('vendor-react');
    expect(
      __testing.sharedManualChunks(
        '/repo/node_modules/.pnpm/react-dom@19/node_modules/react-dom/client.js',
      ),
    ).toBe('vendor-react');
    expect(
      __testing.sharedManualChunks(
        '/repo/node_modules/.pnpm/@emotion+react/node_modules/@emotion/react/dist/index.js',
      ),
    ).toBe('vendor-ui-runtime');
    expect(
      __testing.sharedManualChunks(
        '/repo/node_modules/.pnpm/motion@12/node_modules/motion/react/dist/index.js',
      ),
    ).toBe('vendor-ui-runtime');
    expect(
      __testing.sharedManualChunks(
        '/repo/node_modules/.pnpm/lucide-react/node_modules/lucide-react/dist/index.js',
      ),
    ).toBe('vendor-icons');
    expect(
      __testing.sharedManualChunks(
        '/repo/node_modules/.pnpm/zustand@5/node_modules/zustand/esm/index.mjs',
      ),
    ).toBe('vendor-data-runtime');
    expect(
      __testing.sharedManualChunks('/repo/packages/model-runtime/src/providers/openai/index.ts'),
    ).toBe('vendor-ai-runtime');
    expect(
      __testing.sharedManualChunks(
        '/repo/node_modules/.pnpm/openai@4/node_modules/openai/index.mjs',
      ),
    ).toBe('vendor-ai-runtime');
  });
});
