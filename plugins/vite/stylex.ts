import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import stylex from '@stylexjs/unplugin/vite';
import type { Plugin, PluginOption, UserConfig } from 'vite';

import { stylexProxiedDevCssPlugin } from './stylexDevCss';
import { createStylexEntryCss } from './stylexEntryCss';

const findRepoRoot = (start: string) => {
  let dir = start;
  for (;;) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
};

const repoRootFromMeta = () => {
  const url = import.meta.url;
  if (!url.startsWith('file:')) return;
  return path.resolve(fileURLToPath(new URL('../..', url)));
};

const repoRoot =
  [repoRootFromMeta(), findRepoRoot(process.cwd())].find(
    (dir) => dir && existsSync(path.join(dir, 'pnpm-workspace.yaml')),
  ) ?? process.cwd();

const isTest = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';

// Uncompiled defineConsts. Pre-bundling them removes the call before StyleX can
// inline var(--lobe-*) and the media queries.
export const stylexTokenModules = [
  '@lobehub/ui/stylex/cssVar.stylex',
  '@lobehub/ui/stylex/media.stylex',
] as const;

const classNamePrefix = 'lh';

export interface StylexPluginOptions {
  overlaySrcDirs?: string[];
}

// A host repo that overlays this one resolves `@/*` to its own src before ours,
// so StyleX must try the same directories in the same order to find its
// `.stylex.ts` files.
export const stylexAliases = (overlaySrcDirs: string[] = []) => {
  const srcDirs = [...new Set([...overlaySrcDirs, path.join(repoRoot, 'src')])];
  return { '@/*': srcDirs.map((dir) => path.join(dir, '*')) };
};

export function stylexPlugin({ overlaySrcDirs }: StylexPluginOptions = {}): PluginOption {
  const entryCss = createStylexEntryCss(classNamePrefix);
  const plugin = stylex({
    aliases: stylexAliases(overlaySrcDirs),
    classNamePrefix,
    cssInjectionTarget: entryCss.cssInjectionTarget,
    dev: !isTest && process.env.NODE_ENV !== 'production',
    // Keep :dir() and logical properties. lightningcss would otherwise rewrite them
    // for the default browserslist and break StyleX RTL rules.
    lightningcssOptions: {
      exclude: 4 | 524_288,
    },
    runtimeInjection: isTest,
    test: isTest,
    unstable_moduleResolution: {
      rootDir: repoRoot,
      type: 'commonJS',
    },
  });

  const plugins = (Array.isArray(plugin) ? plugin : [plugin]) as Plugin[];
  for (const item of plugins) {
    // @lobehub/ui depends on @stylexjs/stylex but ships precompiled CSS. This hook
    // would pull that package out of dependency pre-bundling.
    delete item.config;
    // The unplugin polls a shared CSS store from configureServer and keeps Vitest's
    // Vite server alive after the run.
    if (isTest) delete item.configureServer;
    if (!isTest && typeof item.buildStart === 'function' && typeof item.transform === 'function') {
      const buildStart = item.buildStart;
      const transform = item.transform;
      const require = createRequire(path.join(repoRoot, 'package.json'));
      item.buildStart = async function (options) {
        await buildStart.call(this, options);
        // commonJS token references are placeholders until their defineConsts
        // modules are collected. Register them before dev CSS can be requested.
        for (const tokenModule of stylexTokenModules) {
          const filename = require.resolve(tokenModule);
          await Reflect.apply(transform, this, [readFileSync(filename, 'utf8'), filename]);
        }
      };
    }
  }

  const [locateEntryCss, verifyEntryCss] = entryCss.plugins;
  return [locateEntryCss, ...plugins, verifyEntryCss, stylexProxiedDevCssPlugin()] as PluginOption;
}

/**
 * stylexPlugin for a package's own Vitest config. Vitest hands node_modules to
 * Node untransformed, and the token modules are uncompiled defineConsts calls
 * that throw at runtime, so they are inlined into the Vite transform instead.
 */
export function stylexPluginForVitest(): PluginOption {
  return [
    stylexPlugin(),
    {
      // `test` is declared by Vitest's augmentation of its own Vite copy, which a
      // host repo on another Vitest major does not see.
      config: () =>
        ({
          test: { server: { deps: { inline: [/@lobehub[/\\]ui[/\\]es[/\\]stylex[/\\]/] } } },
        }) as UserConfig,
      name: 'lobe-stylex-vitest-deps',
    },
  ];
}
