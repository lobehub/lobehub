import { describe, expect, it } from 'vitest';

import {
  __testing,
  createEntrySetLabeler,
  createSharedRolldownOutput,
  sharedModulePreload,
  sharedOptimizeDeps,
  sharedRendererDedupe,
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

describe('lobe-dev-editor-provider', () => {
  it('sends the provider entry back to the one prebundled editor bundle', async () => {
    const plugin = sharedRendererPlugins({ platform: 'web' })
      .flat(Number.POSITIVE_INFINITY)
      .find(
        (
          item,
        ): item is { name: string; resolveId: (source: string, importer: string) => unknown } =>
          Boolean(item) &&
          typeof item === 'object' &&
          (item as { name?: string }).name === 'lobe-dev-editor-provider',
      );

    const resolve = async (source: string) =>
      plugin!.resolveId.call(
        { resolve: async (id: string) => ({ id }) },
        source,
        '/repo/src/layout/GlobalProvider/Editor.tsx',
      );

    await expect(resolve('@lobehub/editor/react/EditorProvider')).resolves.toEqual({
      id: '@lobehub/editor/react',
    });
    await expect(resolve('@lobehub/editor/react')).resolves.toBeNull();
  });
});

describe('sharedOptimizeDeps', () => {
  it('pre-bundles the root and base-ui entrypoints together', () => {
    expect(sharedOptimizeDeps.include).toEqual(
      expect.arrayContaining(['@lobehub/ui', '@lobehub/ui/base-ui']),
    );
  });
});

describe('sharedRendererDedupe', () => {
  it('keeps editor entrypoints on one shared context instance', () => {
    expect(sharedRendererDedupe).toContain('@lobehub/editor');
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

  it('keeps the whole antd locale graph in the ui-runtime chunk so it cannot form a cycle', () => {
    const pnpm = '/repo/node_modules/.pnpm/antd@6.3.5/node_modules';
    for (const id of [
      `${pnpm}/antd/locale/zh_CN.js`,
      `${pnpm}/antd/es/calendar/locale/zh_CN.js`,
      `${pnpm}/antd/es/date-picker/locale/zh_CN.js`,
      `${pnpm}/antd/es/time-picker/locale/zh_CN.js`,
      '/repo/node_modules/@rc-component/pagination/es/locale/zh_CN.js',
      '/repo/node_modules/@rc-component/picker/es/locale/zh_CN.js',
    ]) {
      expect(__testing.sharedManualChunks(id)).toBe('i18n-zh-CN-ui-runtime');
    }
    expect(
      __testing.sharedManualChunks('/repo/node_modules/@rc-component/picker/es/locale/ar_EG.js'),
    ).toBe('i18n-ar-ui-runtime');
  });

  it('leaves antd default en_US component locales with the antd vendor graph', () => {
    expect(
      __testing.sharedManualChunks('/repo/node_modules/antd/es/date-picker/locale/en_US.js'),
    ).toBe(undefined);
    expect(
      __testing.sharedManualChunks('/repo/node_modules/@rc-component/picker/es/locale/common.js'),
    ).toBe(undefined);
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

describe('isUiCoreModule', () => {
  it('folds first-screen @lobehub/ui members into vendor-ui-core and leaves heavy ones lazy', () => {
    const es = '/repo/node_modules/.pnpm/@lobehub+ui@5/node_modules/@lobehub/ui/es/';
    expect(__testing.isUiCoreModule(`${es}Flex/FlexBasic.mjs`)).toBe(true);
    expect(__testing.isUiCoreModule(`${es}base-ui/Button/Button.mjs`)).toBe(true);
    expect(__testing.isUiCoreModule(`${es}hooks/useIsClient.mjs`)).toBe(true);
    expect(__testing.isUiCoreModule(`${es}Markdown/Markdown.mjs`)).toBe(false);
    expect(__testing.isUiCoreModule(`${es}hooks/useMarkdown/index.mjs`)).toBe(false);
    expect(__testing.isUiCoreModule(`${es}base-ui/Select/Select.mjs`)).toBe(false);
    expect(__testing.isUiCoreModule('/repo/node_modules/antd/es/index.js')).toBe(false);
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

const fakeGraph: Record<string, string[]> = {
  '/main.tsx': ['/shared.ts', '/main-only.ts', '/node_modules/antd/es/button.js'],
  '/overlay.tsx': ['/shared.ts', '/overlay-only.ts'],
  '/popup.tsx': ['/shared.ts', '/main-only.ts'],
  '/shared.ts': ['/leaf.ts'],
  '/main-only.ts': [],
  '/overlay-only.ts': [],
  '/leaf.ts': [],
  '/lazy.ts': [],
  '/node_modules/antd/es/button.js': [],
};
const fakeCtx = {
  getModuleInfo: (id: string) => (id in fakeGraph ? { importedIds: fakeGraph[id] } : null),
};
const fakeEntries = { main: '/main.tsx', overlay: '/overlay.tsx', popup: '/popup.tsx' };

describe('createEntrySetLabeler', () => {
  const label = createEntrySetLabeler(fakeEntries);

  it('labels each first-screen module by the entries that statically reach it', () => {
    expect(label('/leaf.ts', fakeCtx)).toBe('main+overlay+popup');
    expect(label('/main-only.ts', fakeCtx)).toBe('main+popup');
    expect(label('/overlay-only.ts', fakeCtx)).toBe('overlay');
    expect(label('/main.tsx', fakeCtx)).toBe('main');
  });

  it('leaves modules no entry reaches statically unlabeled', () => {
    expect(label('/lazy.ts', fakeCtx)).toBeNull();
  });

  it('matches Windows entry paths against normalized module graph IDs', () => {
    const windowsLabel = createEntrySetLabeler({
      main: 'C:\\repo\\main.tsx',
      overlay: 'C:\\repo\\overlay.tsx',
      popup: 'C:\\repo\\popup.tsx',
    });
    const graph = Object.fromEntries(
      Object.entries(fakeGraph).map(([id, imports]) => [
        `C:/repo${id}`,
        { importedIds: imports.map((dependency) => `C:/repo${dependency}`) },
      ]),
    );
    const ctx = { getModuleInfo: (id: string) => graph[id] ?? null };

    expect(windowsLabel('C:/repo/main.tsx', ctx)).toBe('main');
    expect(windowsLabel('C:/repo/leaf.ts', ctx)).toBe('main+overlay+popup');
    expect(windowsLabel('C:/repo/main-only.ts', ctx)).toBe('main+popup');
    expect(windowsLabel('C:/repo/overlay-only.ts', ctx)).toBe('overlay');
    expect(windowsLabel('C:/repo/lazy.ts', ctx)).toBeNull();
  });

  it('fails loudly when an entry module is not in the graph', () => {
    const broken = createEntrySetLabeler({ main: '/missing.tsx' });
    expect(() => broken('/leaf.ts', fakeCtx)).toThrow(/missing\.tsx/);
  });
});

type OutputGroup = ReturnType<typeof createSharedRolldownOutput>['codeSplitting']['groups'][number];
const nameOf = (group: OutputGroup | undefined, id: string) =>
  typeof group?.name === 'function' ? group.name(id, fakeCtx) : group?.name;

describe('createSharedRolldownOutput', () => {
  const groups = (options?: Parameters<typeof createSharedRolldownOutput>[0]) =>
    createSharedRolldownOutput(options).codeSplitting.groups as OutputGroup[];
  const initialGroup = (list: OutputGroup[], vendor: string) =>
    list.find(
      (g) =>
        g.priority >= 10 &&
        (g.name === vendor || nameOf(g, '/node_modules/antd/es/button.js')?.startsWith(vendor)),
    );

  it('keeps the single-name first-screen catch-all for single-entry builds', () => {
    expect(groups().at(-1)).toMatchObject({ name: 'app-initial', tags: ['$initial'] });
    expect(initialGroup(groups(), 'vendor-antd')).toMatchObject({ tags: ['$initial'] });
    expect(initialGroup(groups(), 'vendor-antd')?.name).toBe('vendor-antd');
  });

  it('splits first-screen chunks, vendor groups included, per entry set for multi-entry builds', () => {
    const output = createSharedRolldownOutput({ initialEntries: fakeEntries, splitInitial: false });
    const list = output.codeSplitting.groups as OutputGroup[];

    expect(output.codeSplitting).toMatchObject({ includeDependenciesRecursively: false });
    expect(list.some((g) => 'tags' in g)).toBe(false);
    expect(nameOf(list.at(-1), '/main-only.ts')).toBe('initial-main+popup');
    expect(nameOf(list.at(-1), '/lazy.ts')).toBeNull();
    expect(nameOf(initialGroup(list, 'vendor-antd'), '/node_modules/antd/es/button.js')).toBe(
      'vendor-antd-main',
    );
  });

  it('keeps entry-set chunking for multi-entry builds without initial entries', () => {
    const output = createSharedRolldownOutput({ splitInitial: false });
    expect(output.codeSplitting).not.toHaveProperty('includeDependenciesRecursively');
    expect((output.codeSplitting.groups as OutputGroup[]).some((g) => 'tags' in g)).toBe(false);
  });
});
