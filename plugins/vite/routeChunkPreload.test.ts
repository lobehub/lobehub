import { describe, expect, it } from 'vitest';

import { __testing, routeChunkPreload } from './routeChunkPreload';

interface TestOutputChunk {
  code: string;
  dynamicImports: string[];
  facadeModuleId: null | string;
  fileName: string;
  imports: string[];
  moduleIds: string[];
  type: 'chunk';
}

type TestOutputBundle = Record<string, TestOutputChunk | { type: 'asset' }>;

function createChunk(overrides: Partial<TestOutputChunk>): TestOutputChunk {
  return {
    code: '',
    dynamicImports: [],
    facadeModuleId: null,
    fileName: 'assets/chunk.js',
    imports: [],
    moduleIds: [],
    type: 'chunk',
    ...overrides,
  };
}

describe('routeChunkPreload', () => {
  it('creates route preload entries from emitted route chunk filenames', () => {
    const bundle = {
      'assets/agent-CJm8x.js': createChunk({
        dynamicImports: ['assets/MainChatInput-BwuHC6qv.js', 'assets/typescript-D20RI-Hp.js'],
        facadeModuleId: '/repo/src/routes/(main)/agent/index.desktop.tsx',
        fileName: 'assets/agent-CJm8x.js',
        imports: ['vendor/vendor-icons-Bd7x.js'],
        moduleIds: ['/repo/src/routes/(main)/agent/index.desktop.tsx'],
      }),
      'vendor/vendor-icons-Bd7x.js': createChunk({
        facadeModuleId: null,
        fileName: 'vendor/vendor-icons-Bd7x.js',
        moduleIds: ['/repo/node_modules/lucide-react/dist/esm/icons/settings.js'],
      }),
      'assets/MainChatInput-BwuHC6qv.js': createChunk({
        fileName: 'assets/MainChatInput-BwuHC6qv.js',
        moduleIds: ['/repo/src/routes/(main)/agent/features/Conversation/MainChatInput/index.tsx'],
      }),
      'assets/typescript-D20RI-Hp.js': createChunk({
        fileName: 'assets/typescript-D20RI-Hp.js',
        moduleIds: ['/repo/node_modules/@shikijs/langs/dist/typescript.mjs'],
      }),
    } satisfies TestOutputBundle;

    const manifest = __testing.createRoutePreloadManifest(bundle, '/repo');
    const agentEntry = manifest.find((entry) => entry.id === 'desktop-chat-launch');

    expect(agentEntry?.preload).toEqual([
      'assets/agent-CJm8x.js',
      'vendor/vendor-icons-Bd7x.js',
      'assets/MainChatInput-BwuHC6qv.js',
    ]);
  });

  it('matches route modules when built from the cloud repository root', () => {
    const bundle = {
      'assets/agent-CJm8x.js': createChunk({
        facadeModuleId: '/repo/lobehub/src/routes/(main)/agent/index.tsx',
        fileName: 'assets/agent-CJm8x.js',
        moduleIds: ['/repo/lobehub/src/routes/(main)/agent/index.tsx'],
      }),
    } satisfies TestOutputBundle;

    const manifest = __testing.createRoutePreloadManifest(bundle, '/repo');
    const agentEntry = manifest.find((entry) => entry.id === 'desktop-chat-launch');

    expect(agentEntry?.preload).toEqual(['assets/agent-CJm8x.js']);
  });

  it('matches non-index platform-specific route module variants', () => {
    const bundle = {
      'assets/settings-provider-CJm8x.js': createChunk({
        facadeModuleId: '/repo/src/routes/(main)/settings/provider.desktop.tsx',
        fileName: 'assets/settings-provider-CJm8x.js',
        moduleIds: ['/repo/src/routes/(main)/settings/provider.desktop.tsx'],
      }),
    } satisfies TestOutputBundle;

    const manifest = __testing.createRoutePreloadManifest(bundle, '/repo', [
      {
        id: 'custom-settings-provider',
        modules: ['src/routes/(main)/settings/provider'],
        patterns: ['^/settings/provider(/|$)'],
      },
    ]);

    expect(manifest[0]?.preload).toEqual(['assets/settings-provider-CJm8x.js']);
  });

  it('can include static imports for explicitly configured groups', () => {
    const bundle = {
      'assets/agent-CJm8x.js': createChunk({
        facadeModuleId: '/repo/src/routes/(main)/agent/index.tsx',
        fileName: 'assets/agent-CJm8x.js',
        imports: ['vendor/vendor-icons-Bd7x.js'],
        moduleIds: ['/repo/src/routes/(main)/agent/index.tsx'],
      }),
      'vendor/vendor-icons-Bd7x.js': createChunk({
        facadeModuleId: null,
        fileName: 'vendor/vendor-icons-Bd7x.js',
        moduleIds: ['/repo/node_modules/lucide-react/dist/esm/icons/settings.js'],
      }),
    } satisfies TestOutputBundle;

    const manifest = __testing.createRoutePreloadManifest(bundle, '/repo', [
      {
        id: 'custom-agent',
        includeStaticImports: true,
        modules: ['src/routes/(main)/agent'],
        patterns: ['^/agent(/|$)'],
      },
    ]);

    expect(manifest[0]?.preload).toEqual(['assets/agent-CJm8x.js', 'vendor/vendor-icons-Bd7x.js']);
  });

  it('can include dynamic imports for route warmup groups', () => {
    const bundle = {
      'assets/settings-CJm8x.js': createChunk({
        dynamicImports: [
          'assets/settings-provider-D8p.js',
          'assets/typescript-D20RI-Hp.js',
          'assets/pierre-dark-BVeDunhK.js',
          'assets/mermaid.core-FQG0m7QG.js',
        ],
        facadeModuleId: '/repo/src/routes/(main)/settings/index.tsx',
        fileName: 'assets/settings-CJm8x.js',
        imports: ['vendor/vendor-icons-Bd7x.js'],
        moduleIds: ['/repo/src/routes/(main)/settings/index.tsx'],
      }),
      'assets/settings-provider-D8p.js': createChunk({
        fileName: 'assets/settings-provider-D8p.js',
        moduleIds: ['/repo/src/routes/(main)/settings/provider/index.tsx'],
      }),
      'assets/typescript-D20RI-Hp.js': createChunk({
        fileName: 'assets/typescript-D20RI-Hp.js',
        moduleIds: ['/repo/node_modules/@shikijs/langs/dist/typescript.mjs'],
      }),
      'assets/pierre-dark-BVeDunhK.js': createChunk({
        fileName: 'assets/pierre-dark-BVeDunhK.js',
      }),
      'assets/mermaid.core-FQG0m7QG.js': createChunk({
        imports: ['assets/cytoscape.esm-B2pAKChx.js'],
        fileName: 'assets/mermaid.core-FQG0m7QG.js',
      }),
      'assets/cytoscape.esm-B2pAKChx.js': createChunk({
        fileName: 'assets/cytoscape.esm-B2pAKChx.js',
      }),
      'assets/graphlib-s-2OPgNI.js': createChunk({
        fileName: 'assets/graphlib-s-2OPgNI.js',
        moduleIds: ['/repo/node_modules/graphlib/index.js'],
      }),
      'vendor/vendor-icons-Bd7x.js': createChunk({
        fileName: 'vendor/vendor-icons-Bd7x.js',
        moduleIds: ['/repo/node_modules/lucide-react/dist/esm/icons/settings.js'],
      }),
    } satisfies TestOutputBundle;

    const manifest = __testing.createRoutePreloadManifest(bundle, '/repo', [
      {
        id: 'custom-settings',
        includeDynamicImports: true,
        includeStaticImports: true,
        modules: ['src/routes/(main)/settings'],
        patterns: ['^/settings(/|$)'],
      },
    ]);

    expect(manifest[0]?.preload).toEqual([
      'assets/settings-CJm8x.js',
      'vendor/vendor-icons-Bd7x.js',
      'assets/settings-provider-D8p.js',
    ]);
  });

  it('warms additional desktop secondary route families during idle time', () => {
    const bundle = {
      'assets/group-CJm8x.js': createChunk({
        facadeModuleId: '/repo/src/routes/(main)/group/index.desktop.tsx',
        fileName: 'assets/group-CJm8x.js',
        moduleIds: ['/repo/src/routes/(main)/group/index.desktop.tsx'],
      }),
      'assets/group-profile-D8p.js': createChunk({
        facadeModuleId: '/repo/src/routes/(main)/group/profile/index.tsx',
        fileName: 'assets/group-profile-D8p.js',
        moduleIds: ['/repo/src/routes/(main)/group/profile/index.tsx'],
      }),
      'assets/community-detail-model-B2.js': createChunk({
        facadeModuleId: '/repo/src/routes/(main)/community/(detail)/model/index.tsx',
        fileName: 'assets/community-detail-model-B2.js',
        moduleIds: ['/repo/src/routes/(main)/community/(detail)/model/index.tsx'],
      }),
      'assets/memory-contexts-B9.js': createChunk({
        facadeModuleId: '/repo/src/routes/(main)/memory/contexts/index.tsx',
        fileName: 'assets/memory-contexts-B9.js',
        moduleIds: ['/repo/src/routes/(main)/memory/contexts/index.tsx'],
      }),
      'assets/image-B3.js': createChunk({
        facadeModuleId: '/repo/src/routes/(main)/(create)/image/index.tsx',
        fileName: 'assets/image-B3.js',
        moduleIds: ['/repo/src/routes/(main)/(create)/image/index.tsx'],
      }),
      'assets/eval-run-C8.js': createChunk({
        facadeModuleId: '/repo/src/routes/(main)/eval/bench/[benchmarkId]/runs/[runId]/index.tsx',
        fileName: 'assets/eval-run-C8.js',
        moduleIds: ['/repo/src/routes/(main)/eval/bench/[benchmarkId]/runs/[runId]/index.tsx'],
      }),
    } satisfies TestOutputBundle;

    const manifest = __testing.createRoutePreloadManifest(
      bundle,
      '/repo',
      __testing.defaultIdleRoutePreloadGroups,
    );
    const preloadByGroup = new Map(manifest.map((entry) => [entry.id, entry.preload]));

    expect(preloadByGroup.get('desktop-group-chat')).toEqual([
      'assets/group-CJm8x.js',
      'assets/group-profile-D8p.js',
    ]);
    expect(preloadByGroup.get('desktop-community')).toEqual([
      'assets/community-detail-model-B2.js',
    ]);
    expect(preloadByGroup.get('desktop-memory')).toEqual(['assets/memory-contexts-B9.js']);
    expect(preloadByGroup.get('desktop-create')).toEqual(['assets/image-B3.js']);
    expect(preloadByGroup.get('desktop-eval')).toEqual(['assets/eval-run-C8.js']);
  });

  it('keeps low-probability routes out of the default preload manifest', () => {
    const bundle = {
      'assets/settings-CJm8x.js': createChunk({
        facadeModuleId: '/repo/src/routes/(main)/settings/index.tsx',
        fileName: 'assets/settings-CJm8x.js',
        moduleIds: ['/repo/src/routes/(main)/settings/index.tsx'],
      }),
    } satisfies TestOutputBundle;

    expect(__testing.createRoutePreloadManifest(bundle, '/repo')).toEqual([]);
  });

  it('creates a sorted all-JS warmup manifest from emitted chunks', () => {
    const bundle = {
      'assets/agent-CJm8x.js': createChunk({
        fileName: 'assets/agent-CJm8x.js',
      }),
      'assets/i18n-en-US-DjOrYbGM.js': createChunk({
        fileName: 'assets/i18n-en-US-DjOrYbGM.js',
      }),
      'assets/style-D8p.css': createChunk({
        fileName: 'assets/style-D8p.css',
      }),
      'i18n/i18n-default-BV0oTRYH.js': createChunk({
        fileName: 'i18n/i18n-default-BV0oTRYH.js',
      }),
      'assets/javascript-C1Q1DjBS.js': createChunk({
        fileName: 'assets/javascript-C1Q1DjBS.js',
        moduleIds: ['/repo/node_modules/@shikijs/langs/dist/javascript.mjs'],
      }),
      'assets/github-dark-Bo88FFvI.js': createChunk({
        fileName: 'assets/github-dark-Bo88FFvI.js',
        moduleIds: ['/repo/node_modules/@shikijs/themes/dist/github-dark.mjs'],
      }),
      'assets/wasm-CGWTL0IK.js': createChunk({
        fileName: 'assets/wasm-CGWTL0IK.js',
        moduleIds: ['/repo/node_modules/oniguruma-to-es/dist/wasm.mjs'],
      }),
      'assets/pierre-light-Dmd9-PaL.js': createChunk({
        fileName: 'assets/pierre-light-Dmd9-PaL.js',
      }),
      'assets/mermaid-parser.core-BLfQKdsC.js': createChunk({
        fileName: 'assets/mermaid-parser.core-BLfQKdsC.js',
      }),
      'assets/rough.esm-BgK9YCbF.js': createChunk({
        fileName: 'assets/rough.esm-BgK9YCbF.js',
        moduleIds: ['/repo/node_modules/roughjs/bin/rough.js'],
      }),
      'vendor/vendor-icons-Bd7x.js': createChunk({
        fileName: 'vendor/vendor-icons-Bd7x.js',
      }),
      'assets/image.png': { type: 'asset' },
    } satisfies TestOutputBundle;

    expect(__testing.createAllJsWarmupManifest(bundle)).toEqual([
      'assets/agent-CJm8x.js',
      'vendor/vendor-icons-Bd7x.js',
    ]);
  });

  it('injects route modulepreload links into html and skips existing module assets', () => {
    const html = [
      '<html>',
      '  <head>',
      '    <script type="module" crossorigin src="/_spa/assets/index-D8p.js?dpl=dpl_test"></script>',
      '    <link rel="modulepreload" crossorigin href="/_spa/assets/existing-B2.js?dpl=dpl_test">',
      '  </head>',
      '</html>',
    ].join('\n');

    const result = __testing.injectRouteModulepreloadsIntoHtml(
      html,
      [
        {
          id: 'desktop-page',
          patterns: ['^/page(/|$)'],
          preload: ['assets/page-B9kLm.js', 'assets/existing-B2.js'],
        },
      ],
      '/_spa/',
      'dpl_test',
    );

    expect(result).toContain(
      '<link rel="modulepreload" crossorigin href="/_spa/assets/page-B9kLm.js?dpl=dpl_test">',
    );
    expect(result.match(/assets\/existing-B2\.js/g)).toHaveLength(1);
    expect(result.match(/assets\/index-D8p\.js/g)).toHaveLength(1);
  });

  it('removes small existing modulepreload links from html', () => {
    const html = [
      '<html>',
      '  <head>',
      '    <link rel="modulepreload" crossorigin href="/_spa/assets/small-D8p.js?dpl=dpl_test">',
      '    <link rel="modulepreload" crossorigin href="/_spa/assets/large-D8p.js?dpl=dpl_test">',
      '  </head>',
      '</html>',
    ].join('\n');

    const result = __testing.removeSmallModulepreloadsFromHtml(
      html,
      '/_spa/',
      (fileName) => fileName === 'assets/large-D8p.js',
    );

    expect(result).not.toContain('/_spa/assets/small-D8p.js');
    expect(result).toContain('/_spa/assets/large-D8p.js?dpl=dpl_test');
  });

  it('appends the deployment query to emitted preload assets', () => {
    expect(__testing.createAssetHref('assets/page-B9kLm.js', '/_spa/', 'dpl_test')).toBe(
      '/_spa/assets/page-B9kLm.js?dpl=dpl_test',
    );
    expect(
      __testing.createAssetHref('assets/page-B9kLm.js?dpl=dpl_test', '/_spa/', 'dpl_test'),
    ).toBe('/_spa/assets/page-B9kLm.js?dpl=dpl_test');
  });

  it('injects emitted route preloads into html with the Vite html transform hook', () => {
    const plugin = routeChunkPreload({ allJsWarmup: true });
    const configResolved = plugin.configResolved as (config: {
      base: string;
      root: string;
    }) => void;
    const bundle = {
      'assets/agent-CJm8x.js': createChunk({
        code: 'x'.repeat(2048),
        facadeModuleId: '/repo/src/routes/(main)/agent/index.tsx',
        fileName: 'assets/agent-CJm8x.js',
        moduleIds: ['/repo/src/routes/(main)/agent/index.tsx'],
      }),
      'assets/settings-D8p.js': createChunk({
        code: 'x'.repeat(2048),
        facadeModuleId: '/repo/src/routes/(main)/settings/index.tsx',
        fileName: 'assets/settings-D8p.js',
        moduleIds: ['/repo/src/routes/(main)/settings/index.tsx'],
      }),
    } satisfies TestOutputBundle;
    const transformIndexHtml = plugin.transformIndexHtml as {
      handler: (html: string, ctx: { bundle: TestOutputBundle }) => string;
    };

    configResolved({ base: '/_spa/', root: '/repo' });
    const result = transformIndexHtml.handler(
      '<html><head><script type="module" crossorigin src="/_spa/assets/index-D8p.js"></script></head><body></body></html>',
      { bundle },
    );

    expect(result).toContain('/_spa/assets/agent-CJm8x.js');
    expect(result).toContain('/_spa/assets/settings-D8p.js');
    expect(result).toContain('/_spa/assets/js-warmup-manifest.json');
    expect(result).toContain('rel="modulepreload"');
    expect(result).not.toContain('window.__LOBE_PRELOAD_ROUTE__');
    expect(result).not.toContain("import('@/routes");
  });

  it('skips the auth SPA html entirely', () => {
    const plugin = routeChunkPreload();
    const configResolved = plugin.configResolved as (config: {
      base: string;
      root: string;
    }) => void;
    const bundle = {
      'assets/agent-CJm8x.js': createChunk({
        code: 'x'.repeat(2048),
        facadeModuleId: '/repo/src/routes/(main)/agent/index.tsx',
        fileName: 'assets/agent-CJm8x.js',
        moduleIds: ['/repo/src/routes/(main)/agent/index.tsx'],
      }),
    } satisfies TestOutputBundle;
    const transformIndexHtml = plugin.transformIndexHtml as {
      handler: (html: string, ctx: { bundle: TestOutputBundle; path?: string }) => string;
    };

    configResolved({ base: '/_spa/', root: '/repo' });
    const html = '<html><head></head><body></body></html>';
    const result = transformIndexHtml.handler(html, { bundle, path: '/index.auth.html' });

    expect(result).toBe(html);
  });

  it('does not inject the all-JS warmup manifest by default', () => {
    const plugin = routeChunkPreload();
    const configResolved = plugin.configResolved as (config: {
      base: string;
      root: string;
    }) => void;
    const bundle = {
      'assets/agent-CJm8x.js': createChunk({
        code: 'x'.repeat(2048),
        facadeModuleId: '/repo/src/routes/(main)/agent/index.tsx',
        fileName: 'assets/agent-CJm8x.js',
        moduleIds: ['/repo/src/routes/(main)/agent/index.tsx'],
      }),
      'assets/settings-D8p.js': createChunk({
        code: 'x'.repeat(2048),
        facadeModuleId: '/repo/src/routes/(main)/settings/index.tsx',
        fileName: 'assets/settings-D8p.js',
        moduleIds: ['/repo/src/routes/(main)/settings/index.tsx'],
      }),
    } satisfies TestOutputBundle;
    const transformIndexHtml = plugin.transformIndexHtml as {
      handler: (html: string, ctx: { bundle: TestOutputBundle }) => string;
    };

    configResolved({ base: '/_spa/', root: '/repo' });
    const result = transformIndexHtml.handler('<html><head></head><body></body></html>', {
      bundle,
    });

    expect(result).toContain('/_spa/assets/agent-CJm8x.js');
    expect(result).toContain('/_spa/assets/settings-D8p.js');
    expect(result).not.toContain('js-warmup-manifest.json');
  });

  it('keeps tiny route dependencies out of initial html while preserving idle warmup coverage', () => {
    const plugin = routeChunkPreload();
    const configResolved = plugin.configResolved as (config: {
      base: string;
      root: string;
    }) => void;
    const bundle = {
      'assets/agent-CJm8x.js': createChunk({
        code: 'x'.repeat(2048),
        dynamicImports: ['assets/HeaderSlot-D8p.js'],
        facadeModuleId: '/repo/src/routes/(main)/agent/index.tsx',
        fileName: 'assets/agent-CJm8x.js',
        moduleIds: ['/repo/src/routes/(main)/agent/index.tsx'],
      }),
      'assets/HeaderSlot-D8p.js': createChunk({
        code: 'x'.repeat(128),
        fileName: 'assets/HeaderSlot-D8p.js',
        moduleIds: ['/repo/src/routes/(main)/agent/HeaderSlot.tsx'],
      }),
    } satisfies TestOutputBundle;
    const transformIndexHtml = plugin.transformIndexHtml as {
      handler: (html: string, ctx: { bundle: TestOutputBundle }) => string;
    };

    configResolved({ base: '/_spa/', root: '/repo' });
    const result = transformIndexHtml.handler('<html><head></head><body></body></html>', {
      bundle,
    });

    expect(result).toContain(
      '<link rel="modulepreload" crossorigin href="/_spa/assets/agent-CJm8x.js',
    );
    expect(result).not.toContain(
      '<link rel="modulepreload" crossorigin href="/_spa/assets/HeaderSlot-D8p.js',
    );
    expect(result).toContain('"idleRouteFetch":[]');
    expect(result).toContain(
      '"idleRoutePreload":["/_spa/assets/agent-CJm8x.js","/_spa/assets/HeaderSlot-D8p.js"',
    );
    expect(result).toContain('"/_spa/assets/HeaderSlot-D8p.js');
  });

  it('does not warm tiny low-priority idle route chunks', () => {
    const plugin = routeChunkPreload({
      groups: [],
      idleGroups: [
        {
          id: 'custom-settings',
          includeDynamicImports: true,
          modules: ['src/routes/(main)/settings'],
          patterns: ['^/settings(/|$)'],
        },
      ],
    });
    const configResolved = plugin.configResolved as (config: {
      base: string;
      root: string;
    }) => void;
    const bundle = {
      'assets/settings-CJm8x.js': createChunk({
        code: 'x'.repeat(2048),
        dynamicImports: ['assets/tiny-D8p.js'],
        facadeModuleId: '/repo/src/routes/(main)/settings/index.tsx',
        fileName: 'assets/settings-CJm8x.js',
        moduleIds: ['/repo/src/routes/(main)/settings/index.tsx'],
      }),
      'assets/tiny-D8p.js': createChunk({
        code: 'x'.repeat(128),
        fileName: 'assets/tiny-D8p.js',
        moduleIds: ['/repo/src/routes/(main)/settings/Tiny.tsx'],
      }),
    } satisfies TestOutputBundle;
    const transformIndexHtml = plugin.transformIndexHtml as {
      handler: (html: string, ctx: { bundle: TestOutputBundle }) => string;
    };

    configResolved({ base: '/_spa/', root: '/repo' });
    const result = transformIndexHtml.handler('<html><head></head><body></body></html>', {
      bundle,
    });

    expect(result).toContain('"idleRouteFetch":[]');
    expect(result).toContain('"idleRoutePreload":["/_spa/assets/settings-CJm8x.js"');
    expect(result).not.toContain('/_spa/assets/tiny-D8p.js');
  });

  it('can omit the all-JS warmup manifest while keeping idle route warmup', () => {
    const result = __testing.injectIdleWarmupScriptIntoHtml(
      '<html><body></body></html>',
      { idleRouteFetch: [], idleRoutePreload: ['assets/settings-D8p.js'] },
      '/_spa/',
      'dpl_test',
    );

    expect(result).toContain('/_spa/assets/settings-D8p.js?dpl=dpl_test');
    expect(result).not.toContain('js-warmup-manifest.json');
  });

  it('can warm tiny route chunks through fetch without modulepreload links', () => {
    const result = __testing.injectIdleWarmupScriptIntoHtml(
      '<html><body></body></html>',
      { idleRouteFetch: ['assets/tiny-D8p.js'], idleRoutePreload: [] },
      '/_spa/',
      'dpl_test',
    );

    expect(result).toContain('"idleRouteFetch":["/_spa/assets/tiny-D8p.js?dpl=dpl_test"]');
    expect(result).toContain('"idleRoutePreload":[]');
    expect(result).toContain('warmQueue(m.idleRouteFetch||[])');
  });
});
