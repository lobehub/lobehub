import { writeFileSync } from 'node:fs';
import path from 'node:path';

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
import { DEFAULT_PRERENDER_LOCALE } from './app/lib/prerender';

interface StaticCssOptions {
  hrefTemplate: (hash: string) => string;
}

export interface AuthRrConfigOptions {
  /** Directory holding `app/` — the submodule copy when a host repo overlays this app. */
  appRoot: string;
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

export const createAuthRrConfig = ({
  appRoot,
  repoRoot,
  resolvePlugins,
  staticCss,
}: AuthRrConfigOptions) => {
  const prerenderLocale = JSON.stringify(
    process.env.AUTH_PRERENDER_LOCALE || DEFAULT_PRERENDER_LOCALE,
  );
  const define = {
    ...sharedRendererDefine({ isElectron: false, isMobile: false }),
    // Client-side the value is never read — the browser takes the locale off
    // `<html lang>` — but the identifier has to resolve in both environments.
    __AUTH_PRERENDER_LOCALE__: JSON.stringify(DEFAULT_PRERENDER_LOCALE),
  };
  const { 'process.env': _processEnvFallback, ...ssrDefine } = define;
  const prerenderDefine = { ...ssrDefine, __AUTH_PRERENDER_LOCALE__: prerenderLocale };

  const moduleTrace = (needle: string): Plugin => ({
    applyToEnvironment: (environment) => environment.name === (process.env.AUTH_TRACE_ENV || 'ssr'),
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
    name: 'auth-module-trace',
  });

  // The locale dictionaries are ~210KB of the eager client graph. The browser
  // gets its one locale inlined in the document instead, so the module that
  // holds every bundle is swapped for a DOM reader on the client build.
  const clientStubs: Record<string, string> = {
    [path.resolve(appRoot, 'app/shell/authResources.ts')]: path.resolve(
      appRoot,
      'app/shell/authResources.client.ts',
    ),
  };

  const ssrStubs: Record<string, string> = {
    [path.resolve(appRoot, 'app/shell/loadAuthNamespace.ts')]: path.resolve(
      appRoot,
      'app/stubs/loadAuthNamespace.ts',
    ),
  };

  const authSsrStubs = (): Plugin => ({
    applyToEnvironment: (environment) => environment.name === 'ssr',
    enforce: 'pre',
    name: 'auth-ssr-stubs',
    async resolveId(source, importer, options) {
      if (!source.includes('loadAuthNamespace')) return null;

      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });

      return resolved ? (ssrStubs[resolved.id] ?? null) : null;
    },
  });

  const authClientStubs = (): Plugin => ({
    applyToEnvironment: (environment) => environment.name === 'client',
    enforce: 'pre',
    name: 'auth-client-stubs',
    async resolveId(source, importer, options) {
      if (!source.includes('authResources')) return null;

      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });

      return resolved ? (clientStubs[resolved.id] ?? null) : null;
    },
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
    name: 'auth-build-inputs-manifest',
    writeBundle(options) {
      if (!options.dir?.includes('build/client')) return;
      const manifest = [...buildInputIds].sort().join('\n');
      writeFileSync(path.resolve(appRoot, 'build-inputs.txt'), `${manifest}\n`);
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
      name: 'auth-static-css-dev-serve',
    };
  };

  const proxyTarget = process.env.AUTH_API_PROXY || 'https://app.lobehub.com';
  const backendProxy = Object.fromEntries(
    ['/api', '/oidc', '/trpc', '/webapi'].map((prefix) => [
      prefix,
      { changeOrigin: true, target: proxyTarget },
    ]),
  );

  return defineConfig(({ command }) => ({
    base: command === 'serve' ? '/' : process.env.VITE_CDN_BASE || '/',
    environments: {
      client: { define },
      ssr: {
        define: prerenderDefine,
        // The prerender pass runs the built server bundle through plain Node,
        // which rejects the extensionless directory imports some published `es/`
        // bundles still ship — bundle every dependency instead of externalizing.
        resolve: { noExternal: command === 'build' ? true : [] },
      },
    },
    plugins: [
      process.env.AUTH_TRACE_MODULE ? moduleTrace(process.env.AUTH_TRACE_MODULE) : undefined,
      authClientStubs(),
      authSsrStubs(),
      buildInputsManifest(),
      viteMarkdownImport(),
      viteNodeModuleStub(),
      vitePlatformResolve('web'),
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
      port: Number(process.env.AUTH_SPA_PORT_RR) || 3018,
      proxy: backendProxy,
    },
  }));
};
