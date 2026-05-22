import { describe, expect, it } from 'vitest';

import { __testing, routeChunkPreload } from './routeChunkPreload';

interface TestOutputChunk {
  code: string;
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

    const manifest = __testing.createRoutePreloadManifest(bundle, '/repo');
    const agentEntry = manifest.find((entry) => entry.id === 'desktop-chat-launch');

    expect(agentEntry?.preload).toEqual(['assets/agent-CJm8x.js']);
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
      'assets/style-D8p.css': createChunk({
        fileName: 'assets/style-D8p.css',
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
      '    <script type="module" crossorigin src="/_spa/assets/index-D8p.js"></script>',
      '    <link rel="modulepreload" crossorigin href="/_spa/assets/existing-B2.js">',
      '  </head>',
      '</html>',
    ].join('\n');

    const result = __testing.injectRouteModulepreloadsIntoHtml(
      html,
      [{ id: 'desktop-page', patterns: ['^/page(/|$)'], preload: ['assets/page-B9kLm.js'] }],
      '/_spa/',
    );

    expect(result).toContain('<link rel="modulepreload" crossorigin href="/_spa/assets/page-B9kLm.js">');
    expect(result.match(/assets\/existing-B2\.js/g)).toHaveLength(1);
    expect(result.match(/assets\/index-D8p\.js/g)).toHaveLength(1);
  });

  it('injects emitted route preloads into html with the Vite html transform hook', () => {
    const plugin = routeChunkPreload();
    const configResolved = plugin.configResolved as (config: { base: string; root: string }) => void;
    const bundle = {
      'assets/agent-CJm8x.js': createChunk({
        facadeModuleId: '/repo/src/routes/(main)/agent/index.tsx',
        fileName: 'assets/agent-CJm8x.js',
        moduleIds: ['/repo/src/routes/(main)/agent/index.tsx'],
      }),
      'assets/settings-D8p.js': createChunk({
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

  it('can omit the all-JS warmup manifest while keeping idle route warmup', () => {
    const result = __testing.injectIdleWarmupScriptIntoHtml(
      '<html><body></body></html>',
      { idleRoutePreload: ['assets/settings-D8p.js'] },
      '/_spa/',
    );

    expect(result).toContain('/_spa/assets/settings-D8p.js');
    expect(result).not.toContain('js-warmup-manifest.json');
  });
});
