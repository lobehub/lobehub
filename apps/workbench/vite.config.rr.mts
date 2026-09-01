import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { cloudflare } from '@cloudflare/vite-plugin';
import { lobeStaticCssPlugin } from '@lobehub/ui/static-css/vite';
import { reactRouter } from '@react-router/dev/vite';
import { defineConfig, type Plugin } from 'vite';

import { lobeIconImports } from '../../plugins/vite/lobeIconImports';
import { viteMarkdownImport } from '../../plugins/vite/markdownImport';
import { viteNodeModuleStub } from '../../plugins/vite/nodeModuleStub';
import { vitePlatformResolve } from '../../plugins/vite/platformResolve';
import { sharedRendererDefine } from '../../plugins/vite/sharedRendererConfig';
import { shikiCdnUrl } from './app/stubs/shikiCdn';
import { isShikiSource } from './app/stubs/shikiSource';
import { reportStubSurfaceGaps } from './app/stubs/surface';
import { antdStaticCssOptions, themeVarsCssOptions } from './staticCssOptions.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../..');

const define = {
  ...sharedRendererDefine({ isElectron: false, isMobile: true }),
  __WORKBENCH__: 'true',
};

const { 'process.env': _processEnvFallback, ...ssrDefine } = define;

const shikiSsrStub = path.resolve(import.meta.dirname, 'app/stubs/shiki.ts');
const shikiVersion = JSON.parse(
  readFileSync(path.resolve(repoRoot, 'node_modules/shiki/package.json'), 'utf8'),
).version as string;

const ssrStubs: Record<string, string> = {
  '@/libs/trpc/client': path.resolve(import.meta.dirname, 'app/stubs/trpcClient.ts'),
  '@/services/global': path.resolve(import.meta.dirname, 'app/stubs/globalService.ts'),
  '@/store/electron': path.resolve(import.meta.dirname, 'app/stubs/electronStore.ts'),
  '@/store/file': path.resolve(import.meta.dirname, 'app/stubs/fileStore.ts'),
  '@/utils/i18n/loadI18nNamespaceModule': path.resolve(
    import.meta.dirname,
    'app/stubs/loadI18nNamespaceModule.ts',
  ),
};

const workbenchSsrStubs = (): Plugin => ({
  applyToEnvironment: (environment) => environment.name === 'ssr',
  enforce: 'pre',
  name: 'workbench-ssr-stubs',
  resolveId(source, importer) {
    if (ssrStubs[source]) return ssrStubs[source];
    if (isShikiSource(source, importer)) return shikiSsrStub;
  },
});

const i18nClientStub = path.resolve(
  import.meta.dirname,
  'app/stubs/loadI18nNamespaceModule.client.ts',
);

const clientStubs: Record<string, string> = {
  '@/libs/trpc/client': path.resolve(import.meta.dirname, 'app/stubs/trpcClient.client.ts'),
  '@/utils/i18n/loadI18nNamespaceModule': i18nClientStub,
};

const workbenchClientStubs = (): Plugin => ({
  applyToEnvironment: (environment) => environment.name === 'client',
  enforce: 'pre',
  name: 'workbench-client-stubs',
  resolveId(source) {
    return clientStubs[source];
  },
});

const workbenchClientShikiCdn = (): Plugin => ({
  applyToEnvironment: (environment) => environment.name === 'client',
  enforce: 'pre',
  name: 'workbench-client-shiki-cdn',
  resolveId(source) {
    const url = shikiCdnUrl(source, shikiVersion);
    if (!url) return;
    return { external: true, id: url };
  },
});

// Referenced in the client graph only from store tails that never execute in
// workbench flows; requesting one at runtime degrades to raw keys instead of
// bundling 18 locale files each.
const I18N_DEAD_NS = new Set(['electron', 'file', 'modelProvider', 'setting', 'topic', 'video']);

const I18N_NS_PATTERNS = [
  /useTranslation\(\s*['"]([A-Za-z]+)['"]/g,
  /\bns\s*[:=]\s*(?:\{\s*)?['"]([A-Za-z]+)['"]/g,
  /\bt\(\s*['"]([A-Za-z]+):/g,
];
const I18N_NS_ARRAY_PATTERN = /useTranslation\(\s*\[([^\]]*)\]/g;

const stubSurfaceGuard = (env: 'client' | 'ssr', stubs: Record<string, string>): Plugin => ({
  apply: 'build',
  applyToEnvironment: (environment) => environment.name === env,
  buildEnd() {
    const stubEntries = Object.entries(stubs).map(([specifier, file]) => ({
      source: readFileSync(file, 'utf8'),
      specifier,
    }));
    const files: Array<{ rel: string; source: string }> = [];
    for (const id of this.getModuleIds()) {
      if (!id.startsWith(repoRoot) || id.includes('/node_modules/') || id.includes('\0')) continue;
      const file = id.split('?')[0]!;
      if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
      const rel = path.relative(repoRoot, file);
      if (rel.startsWith('apps/workbench/app/stubs/')) continue;
      let source: string;
      try {
        source = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      files.push({ rel, source });
    }
    const lines = reportStubSurfaceGaps(files, stubEntries);
    if (lines.length > 0) {
      this.error(
        `Workbench ${env} stub is missing APIs used by the module graph:\n${lines.join('\n')}\n` +
          `Add the export/member to the matching file in app/stubs/ (empty state or reject), ` +
          `or keep the importer off this graph.`,
      );
    }
  },
  name: `workbench-${env}-stub-surface-guard`,
});

const clientI18nNsGuard = (): Plugin => ({
  apply: 'build',
  applyToEnvironment: (environment) => environment.name === 'client',
  buildEnd() {
    const bundled = new Set(
      [...readFileSync(i18nClientStub, 'utf8').matchAll(/locales\/\*\/([A-Za-z]+)\.json/g)].map(
        (m) => m[1]!,
      ),
    );
    const offenders = new Map<string, Set<string>>();
    for (const id of this.getModuleIds()) {
      if (!id.startsWith(repoRoot) || id.includes('/node_modules/') || id.includes('\0')) continue;
      const file = id.split('?')[0]!;
      if (!/\.tsx?$/.test(file)) continue;
      const rel = path.relative(repoRoot, file);
      if (rel.startsWith('locales/') || rel.startsWith('packages/locales/')) continue;
      let source: string;
      try {
        source = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const found = new Set<string>();
      for (const pattern of I18N_NS_PATTERNS) {
        for (const match of source.matchAll(pattern)) found.add(match[1]!);
      }
      for (const match of source.matchAll(I18N_NS_ARRAY_PATTERN)) {
        for (const inner of match[1]!.matchAll(/['"]([A-Z]+)['"]/gi)) found.add(inner[1]!);
      }
      for (const ns of found) {
        if (bundled.has(ns) || I18N_DEAD_NS.has(ns)) continue;
        if (!offenders.has(ns)) offenders.set(ns, new Set());
        offenders.get(ns)!.add(rel);
      }
    }
    if (offenders.size > 0) {
      const lines = [...offenders].map(([ns, files]) => `  ${ns}: ${[...files].join(', ')}`);
      this.error(
        `i18n namespaces referenced in the client graph but not bundled:\n${lines.join('\n')}\n` +
          `Add glob entries in app/stubs/loadI18nNamespaceModule.client.ts, ` +
          `or add to I18N_DEAD_NS in vite.config.rr.mts if the code path never runs in workbench.`,
      );
    }
  },
  name: 'workbench-client-i18n-ns-guard',
});

const ssrChunkReport = (): Plugin => ({
  applyToEnvironment: (environment) => environment.name === 'ssr',
  generateBundle(_options, bundle) {
    const report: Record<string, unknown> = {};
    for (const [file, chunk] of Object.entries(bundle)) {
      if (chunk.type !== 'chunk') continue;
      report[file] = {
        dynamicImports: chunk.dynamicImports,
        imports: chunk.imports,
        modules: Object.keys(chunk.modules ?? {}),
        size: chunk.code.length,
      };
    }
    writeFileSync(
      path.resolve(import.meta.dirname, 'ssr-chunk-report.json'),
      JSON.stringify(report),
    );
  },
  name: 'workbench-ssr-chunk-report',
});

const ssrModuleTrace = (needle: string): Plugin => ({
  applyToEnvironment: (environment) =>
    environment.name === (process.env.WORKBENCH_TRACE_ENV || 'ssr'),
  buildEnd() {
    const targets = [...this.getModuleIds()].filter((id) => id.includes(needle));
    for (const target of targets.slice(0, 2)) {
      const parent = new Map<string, string | null>([[target, null]]);
      const queue = [target];
      let found: string | null = null;
      while (queue.length > 0 && !found) {
        const current = queue.shift()!;
        const info = this.getModuleInfo(current);
        for (const importer of [...(info?.importers ?? []), ...(info?.dynamicImporters ?? [])]) {
          if (parent.has(importer)) continue;
          parent.set(importer, current);
          queue.push(importer);
          if (importer.includes('apps/workbench') || importer.includes('virtual:react-router')) {
            found = importer;
            break;
          }
        }
      }
      const chain: string[] = [];
      let cursor: string | null = found;
      while (cursor) {
        chain.push(cursor);
        cursor = parent.get(cursor) ?? null;
      }
      console.info(`\n=== module trace: ${target}`);
      console.info(chain.join('\n -> ') || '(no importer path found)');
    }
  },
  name: 'workbench-ssr-module-trace',
});

const proxyTarget = process.env.WORKBENCH_API_PROXY || 'https://app.lobehub.com';

const buildInputIds = new Set<string>();

const buildInputsManifest = (): Plugin => ({
  apply: 'build',
  buildEnd() {
    for (const id of this.getModuleIds()) {
      if (!id.startsWith(repoRoot)) continue;
      if (id.includes('/node_modules/') || id.includes('\0')) continue;
      buildInputIds.add(path.relative(repoRoot, id.split('?')[0]!));
    }
  },
  name: 'workbench-build-inputs-manifest',
  writeBundle(options) {
    if (!options.dir?.includes('build/server')) return;
    const manifest = [...buildInputIds].sort().join('\n');
    writeFileSync(path.resolve(import.meta.dirname, 'build-inputs.txt'), `${manifest}\n`);
  },
});

const staticCssDevServe = (): Plugin => {
  const cache = new Map<string, string>();
  const serve = async (kind: 'antd' | 'themeVars') => {
    if (!cache.has(kind)) {
      const { buildAntdStaticCss, buildThemeVarsCss } = await import('@lobehub/ui/static-css');
      cache.set(
        kind,
        kind === 'antd'
          ? buildAntdStaticCss(antdStaticCssOptions).css
          : buildThemeVarsCss(themeVarsCssOptions).css,
      );
    }
    return cache.get(kind)!;
  };

  return {
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';
        const kind = /^\/assets\/antd-[a-f0-9]+\.css/.test(url)
          ? ('antd' as const)
          : /^\/assets\/theme-vars-[a-f0-9]+\.css/.test(url)
            ? ('themeVars' as const)
            : undefined;
        if (!kind) return next();
        res.setHeader('Content-Type', 'text/css; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(await serve(kind));
      });
    },
    name: 'workbench-static-css-dev-serve',
  };
};

const backendProxy = Object.fromEntries(
  ['/api', '/oidc', '/trpc', '/webapi'].map((prefix) => [
    prefix,
    { changeOrigin: true, target: proxyTarget },
  ]),
);

const isDev = process.env.NODE_ENV !== 'production';

export default defineConfig({
  base: isDev ? '/' : process.env.VITE_CDN_BASE || '/',
  environments: {
    client: { define },
    ssr: { define: ssrDefine },
  },
  plugins: [
    process.env.WORKBENCH_CHUNK_REPORT ? ssrChunkReport() : undefined,
    process.env.WORKBENCH_TRACE_MODULE
      ? ssrModuleTrace(process.env.WORKBENCH_TRACE_MODULE)
      : undefined,
    workbenchSsrStubs(),
    workbenchClientStubs(),
    workbenchClientShikiCdn(),
    stubSurfaceGuard('ssr', ssrStubs),
    stubSurfaceGuard('client', clientStubs),
    clientI18nNsGuard(),
    buildInputsManifest(),
    viteMarkdownImport(),
    viteNodeModuleStub(),
    vitePlatformResolve('mobile'),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    lobeStaticCssPlugin({ antd: antdStaticCssOptions, themeVars: themeVarsCssOptions }),
    staticCssDevServe(),
    reactRouter(),
    ...lobeIconImports(),
  ],
  optimizeDeps: {
    exclude: ['shiki', '@shikijs/core', '@shikijs/stream', '@shikijs/transformers'],
  },
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
    port: Number(process.env.WORKBENCH_SPA_PORT) || 3015,
    proxy: backendProxy,
  },
});
