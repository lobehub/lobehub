import { describe, expect, it } from 'vitest';

import {
  __testing,
  sharedModulePreload,
  sharedOptimizeDeps,
  sharedRendererPlugins,
} from './sharedRendererConfig';

const getPluginNames = (platform: 'desktop' | 'web') =>
  sharedRendererPlugins({ platform })
    .flat(Number.POSITIVE_INFINITY)
    .filter((plugin): plugin is { name: string } => Boolean(plugin) && typeof plugin === 'object')
    .map((plugin) => plugin.name);

describe('sharedRendererPlugins', () => {
  it('keeps the icon barrel transform out of the Electron renderer', () => {
    expect(getPluginNames('desktop')).not.toContain('lobe-icon-named-export-proxy');
    expect(getPluginNames('web')).toContain('lobe-icon-named-export-proxy');
  });
});

describe('sharedOptimizeDeps', () => {
  it('pre-bundles the root and base-ui entrypoints together', () => {
    expect(sharedOptimizeDeps.include).toEqual(
      expect.arrayContaining(['@lobehub/ui', '@lobehub/ui/base-ui']),
    );
  });
});

describe('sharedModulePreload', () => {
  it('keeps regular dependencies while excluding deferred i18n and devtools chunks', () => {
    const resolveDependencies = sharedModulePreload.resolveDependencies!;

    expect(
      resolveDependencies(
        'assets/index.js',
        [
          'assets/vendor-icons.js',
          'vendor/vendor-react.js',
          'i18n/i18n-default.js',
          'assets/i18n-en-US.js',
          'devtools/devtools-abc.js',
          '/_spa/devtools/DevDock-abc.js',
          'assets/devtools-legacy.js',
          'assets/page.js',
        ],
        { hostId: 'index.html', hostType: 'html' },
      ),
    ).toEqual(['assets/vendor-icons.js', 'vendor/vendor-react.js', 'assets/page.js']);
  });
});

describe('sharedManualChunks', () => {
  it('isolates synchronously bundled and heavy namespaces from deferred locale data', () => {
    expect(__testing.sharedManualChunks('/repo/locales/zh-CN/auth.json')).toBe('i18n-zh-CN-auth');
    expect(__testing.sharedManualChunks('/repo/locales/zh-CN/common.json')).toBe(
      'i18n-zh-CN-common',
    );
    expect(__testing.sharedManualChunks('/repo/packages/locales/src/default/oauth.ts')).toBe(
      'i18n-default-oauth',
    );
    expect(__testing.sharedManualChunks('/repo/packages/locales/src/default/chat.ts')).toBe(
      'i18n-default-app-shell',
    );
    expect(__testing.sharedManualChunks('/repo/packages/locales/src/default/home.ts')).toBe(
      'i18n-default-app-shell',
    );
    expect(__testing.sharedManualChunks('/repo/packages/locales/src/default/hotkey.ts')).toBe(
      'i18n-default-hotkey',
    );
    expect(__testing.sharedManualChunks('/repo/packages/locales/src/default/models.ts')).toBe(
      'i18n-default-models',
    );
    expect(__testing.sharedManualChunks('/repo/locales/zh-CN/chat.json')).toBe(
      'i18n-zh-CN-app-shell',
    );
    expect(__testing.sharedManualChunks('/repo/locales/zh-CN/home.json')).toBe(
      'i18n-zh-CN-app-shell',
    );
    expect(__testing.sharedManualChunks('/repo/locales/zh-CN/models.json')).toBe(
      'i18n-zh-CN-models',
    );
    expect(__testing.sharedManualChunks('/repo/locales/zh-CN/setting.json')).toBe('i18n-zh-CN');
  });

  it('keeps UI and date locale runtimes outside deferred namespace data', () => {
    expect(__testing.sharedManualChunks('/repo/node_modules/antd/es/locale/zh_CN.js')).toBe(
      'i18n-zh-CN-ui-runtime',
    );
    expect(__testing.sharedManualChunks('/repo/node_modules/dayjs/locale/zh-cn.js')).toBe(
      'i18n-zh-CN-ui-runtime',
    );
  });

  it('keeps locale runtime helpers out of the default locale chunk', () => {
    expect(__testing.sharedManualChunks('/repo/packages/locales/src/resources.ts')).toBe(undefined);
    expect(__testing.sharedManualChunks('/repo/packages/locales/src/create.ts')).toBe(undefined);
  });

  it('groups shared constants into a dedicated chunk', () => {
    expect(__testing.sharedManualChunks('/repo/packages/const/src/url.ts')).toBe('app-const');
  });

  it('keeps DevDock source boundaries intact and groups only dedicated packages', () => {
    expect(__testing.sharedManualChunks('/repo/src/features/DevDock/index.tsx')).toBeUndefined();
    expect(__testing.sharedManualChunks('/repo/src/utils/devDockUnlock.ts')).toBeUndefined();
    expect(
      __testing.sharedManualChunks(
        '/repo/node_modules/.pnpm/react-scan/node_modules/react-scan/dist/index.js',
      ),
    ).toBe('devtools-react-scan');
  });

  it('places natural DevDock chunks in the specialized devtools asset directory', () => {
    expect(
      __testing.sharedChunkFileNames({
        moduleIds: ['/repo/src/features/DevDock/index.tsx'],
        name: 'index',
      }),
    ).toBe('devtools/[name]-[hash].js');
    expect(
      __testing.sharedChunkFileNames({
        moduleIds: ['/repo/src/features/Conversation/ChatList/components/Message.tsx'],
        name: 'message',
      }),
    ).toBe('assets/[name]-[hash].js');
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
      __testing.sharedManualChunks(
        '/repo/node_modules/.pnpm/openai@4/node_modules/openai/index.mjs',
      ),
    ).toBe('vendor-ai-runtime');
  });

  it('lets model-runtime follow dynamic import boundaries', () => {
    expect(
      __testing.sharedManualChunks('/repo/packages/model-runtime/src/providers/openai/index.ts'),
    ).toBeUndefined();
    expect(
      __testing.sharedManualChunks('/repo/packages/model-runtime/src/helpers/parseToolCalls.ts'),
    ).toBe('model-runtime-client');
    expect(
      __testing.sharedManualChunks('/repo/packages/model-runtime/src/types/toolsCalling.ts'),
    ).toBe('model-runtime-client');
    expect(
      __testing.sharedManualChunks(
        '/repo/packages/model-runtime/src/utils/getFallbackModelProperty.ts',
      ),
    ).toBeUndefined();
    expect(__testing.sharedManualChunks('/repo/packages/model-bank/src/index.ts')).toBeUndefined();
  });
});

describe('sharedChunkFileNames', () => {
  it('routes only the complete deferred model catalog to on-demand assets', () => {
    expect(
      __testing.sharedChunkFileNames({
        moduleIds: [
          '/repo/packages/model-bank/src/aiModels/index.ts',
          '/repo/packages/model-bank/src/aiModels/openai.ts',
        ],
        name: 'src',
      }),
    ).toBe('model-bank/[name]-[hash].js');

    expect(
      __testing.sharedChunkFileNames({
        moduleIds: ['/repo/packages/model-bank/src/aiModels/opencodeZen.ts'],
        name: 'opencodeZen',
      }),
    ).toBe('assets/[name]-[hash].js');
  });

  it('routes only self-contained Shiki language, theme, and WASM chunks to on-demand assets', () => {
    expect(
      __testing.sharedChunkFileNames({
        moduleIds: ['/repo/node_modules/@shikijs/langs/dist/python.mjs'],
        name: 'python',
      }),
    ).toBe('shiki/[name]-[hash].js');
    expect(
      __testing.sharedChunkFileNames({
        moduleIds: ['/repo/node_modules/@shikijs/themes/dist/github-dark.mjs'],
        name: 'github-dark',
      }),
    ).toBe('shiki/[name]-[hash].js');
    expect(
      __testing.sharedChunkFileNames({
        moduleIds: [
          '/repo/node_modules/@shikijs/engine-oniguruma/dist/wasm-inlined.mjs',
          '/repo/node_modules/shiki/dist/wasm.mjs',
        ],
        name: 'wasm',
      }),
    ).toBe('shiki/[name]-[hash].js');

    expect(
      __testing.sharedChunkFileNames({
        moduleIds: [
          '/repo/node_modules/@shikijs/core/dist/index.mjs',
          '/repo/src/features/Conversation/Markdown/index.tsx',
        ],
        name: 'markdown',
      }),
    ).toBe('assets/[name]-[hash].js');
  });
});
