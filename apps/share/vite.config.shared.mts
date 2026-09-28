import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { cloudflare } from '@cloudflare/vite-plugin';
import { lobeStaticCssPlugin } from '@lobehub/ui/static-css/vite';
import { reactRouter } from '@react-router/dev/vite';
import { defineConfig, type Plugin, type PluginOption } from 'vite';

import { lobeIconImports } from '../../plugins/vite/lobeIconImports';
import { viteMarkdownImport } from '../../plugins/vite/markdownImport';
import { viteNodeModuleStub } from '../../plugins/vite/nodeModuleStub';
import { vitePlatformResolve } from '../../plugins/vite/platformResolve';
import {
  sharedRendererDedupe,
  sharedRendererDefine,
} from '../../plugins/vite/sharedRendererConfig';

interface StaticCssOptions {
  hrefTemplate: (hash: string) => string;
}

export interface ShareRrConfigOptions {
  /** Directory holding `app/` and `src/` — the submodule copy when a host repo overlays this app. */
  appRoot: string;
  /**
   * Extra SSR module stubs, by import specifier. A host repo overlaying this
   * app adds the store hubs only its own code reaches — the worker renders no
   * signed-in surface, so those must not enter its graph.
   */
  extraSsrStubs?: Record<string, string>;
  /** Repo whose files count as build inputs and are allowed by the dev server. */
  repoRoot: string;
  /**
   * Resolution for `@/*`. Vite 8 native tsconfigPaths walks to the tsconfig
   * nearest each importer, which loses a host repo's overlay paths — those
   * hosts pass their own resolver plugin here instead.
   */
  resolvePlugins?: PluginOption[];
  staticCss: { antd: StaticCssOptions; themeVars: StaticCssOptions };
}

const CLIENT_MODULE_RE = /\.client(?:\.[jt]sx?)?$/;

export const createShareRrConfig = ({
  appRoot,
  extraSsrStubs,
  repoRoot,
  resolvePlugins,
  staticCss,
}: ShareRrConfigOptions) => {
  const define = sharedRendererDefine({ isElectron: false, isMobile: false });
  const { 'process.env': _processEnvFallback, ...ssrDefine } = define;

  const stub = (file: string) => path.resolve(appRoot, 'app/stubs', file);

  const ssrStubs: Record<string, string> = {
    '@/libs/trpc/client': stub('trpcClient.ts'),
    '@/services/global': stub('globalService.ts'),
    '@/spa/initialize/toolSurfaces': stub('toolSurfaces.ts'),
    '@/store/electron': stub('electronStore.ts'),
    '@/store/file': stub('fileStore.ts'),
    '@/store/user': stub('userStore.ts'),
    '@/utils/i18n/loadI18nNamespaceModule': stub('loadI18nNamespaceModule.ts'),
    'shiki': stub('shiki.ts'),
    'shiki/wasm': stub('shikiWasm.ts'),
    ...extraSsrStubs,
  };

  const shareSsrStubs = (): Plugin => ({
    applyToEnvironment: (environment) => environment.name === 'ssr',
    enforce: 'pre',
    name: 'share-ssr-stubs',
    resolveId(source) {
      return ssrStubs[source];
    },
  });

  // `clientOnly()` gates rendering, but the dynamic import still pulls the gated
  // graph into the worker bundle. Cutting it at resolve time is what actually
  // keeps the conversation stack out of build/server.
  const shareClientOnlyStub = (): Plugin => ({
    applyToEnvironment: (environment) => environment.name === 'ssr',
    name: 'share-client-only-stub',
    async resolveId(source, importer, options) {
      if (!CLIENT_MODULE_RE.test(source)) return null;

      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved || !resolved.id.startsWith(appRoot)) return null;

      return stub('clientOnlyModule.tsx');
    },
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
      writeFileSync(path.resolve('ssr-chunk-report.json'), JSON.stringify(report));
    },
    name: 'share-ssr-chunk-report',
  });

  const ssrModuleTrace = (needle: string): Plugin => ({
    applyToEnvironment: (environment) =>
      environment.name === (process.env.SHARE_TRACE_ENV || 'ssr'),
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
            if (importer.startsWith(appRoot) || importer.includes('virtual:react-router')) {
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
    name: 'share-ssr-module-trace',
  });

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
    name: 'share-build-inputs-manifest',
    writeBundle(options) {
      if (!options.dir?.includes('build/server')) return;
      const manifest = [...buildInputIds].sort().join('\n');
      writeFileSync(path.resolve('build-inputs.txt'), `${manifest}\n`);
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
            ? buildAntdStaticCss(staticCss.antd).css
            : buildThemeVarsCss(staticCss.themeVars).css,
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
      name: 'share-static-css-dev-serve',
    };
  };

  const proxyTarget = process.env.SHARE_API_PROXY || 'https://app.lobehub.com';
  const backendProxy = Object.fromEntries(
    ['/api', '/oidc', '/trpc', '/webapi'].map((prefix) => [
      prefix,
      { changeOrigin: true, target: proxyTarget },
    ]),
  );

  const isDev = process.env.NODE_ENV !== 'production';

  return defineConfig({
    base: isDev ? '/' : process.env.VITE_CDN_BASE || '/',
    environments: {
      client: { define },
      ssr: { define: ssrDefine },
    },
    plugins: [
      process.env.SHARE_CHUNK_REPORT ? ssrChunkReport() : undefined,
      process.env.SHARE_TRACE_MODULE ? ssrModuleTrace(process.env.SHARE_TRACE_MODULE) : undefined,
      shareSsrStubs(),
      shareClientOnlyStub(),
      buildInputsManifest(),
      viteMarkdownImport(),
      viteNodeModuleStub(),
      vitePlatformResolve('web'),
      cloudflare({ viteEnvironment: { name: 'ssr' } }),
      lobeStaticCssPlugin({ antd: staticCss.antd, themeVars: staticCss.themeVars }),
      staticCssDevServe(),
      reactRouter(),
      ...lobeIconImports(),
      ...(resolvePlugins ?? []),
    ],
    resolve: {
      // The builtin-tool packages declare `@lobehub/ui: ^5` and resolve to an
      // older copy than the app's; without deduping, their render surfaces fail
      // to import components that only exist in the app's version.
      dedupe: [...sharedRendererDedupe, '@lobehub/ui'],
      tsconfigPaths: !resolvePlugins,
    },
    server: {
      fs: {
        allow: [repoRoot],
      },
      port: Number(process.env.SHARE_SPA_PORT_RR) || 3017,
      proxy: backendProxy,
    },
  });
};
