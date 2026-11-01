import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { IndexHtmlTransformResult, Plugin } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyDesktopViteConfigExtension,
  REACT_DEVTOOLS_BRIDGE_URL,
  reactDevtoolsPlugin,
} from './vite.shared';

describe('applyDesktopViteConfigExtension', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
    );
  });

  it('loads named exports from TypeScript extensions through the Vite module runner', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'lobe-desktop-vite-extension-'));
    const extensionPath = path.join(directory, 'extension.mts');
    temporaryDirectories.push(directory);

    await writeFile(
      extensionPath,
      `export const extendDesktopViteConfig = ({ config, target }) => ({
  ...config,
  define: { __TEST_TARGET__: JSON.stringify(target) },
});
`,
    );
    vi.stubEnv('LOBE_DESKTOP_VITE_CONFIG_EXTENSION', extensionPath);

    const config = await applyDesktopViteConfigExtension(
      'main',
      {},
      { command: 'build', mode: 'development' },
    );

    expect(config.define).toEqual({ __TEST_TARGET__: '"main"' });
  });

  it('loads Cloud build tools from the locked Desktop installation', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'lobe-cloud-tools-'));
    temporaryDirectories.push(directory);
    for (const name of ['@sentry/vite-plugin', 'magic-string']) {
      const pkg = path.join(directory, 'node_modules', name);
      await mkdir(pkg, { recursive: true });
      await writeFile(path.join(pkg, 'package.json'), JSON.stringify({ main: 'index.js', name }));
      await writeFile(
        path.join(pkg, 'index.js'),
        'throw new Error("Loaded unlocked Cloud dependency");',
      );
    }
    const extensionPath = path.join(directory, 'extension.mts');
    await writeFile(
      extensionPath,
      `
      import { sentryVitePlugin } from '@sentry/vite-plugin';
      import MagicString from 'magic-string';
      export const extendDesktopViteConfig = ({ config }) => ({
        ...config, define: { tool: typeof sentryVitePlugin, text: new MagicString('locked').toString() },
      });
    `,
    );
    vi.stubEnv('LOBE_DESKTOP_VITE_CONFIG_EXTENSION', extensionPath);
    const config = await applyDesktopViteConfigExtension(
      'main',
      {},
      { command: 'build', mode: 'development' },
    );
    expect(config.define).toEqual({ tool: 'function', text: 'locked' });
  });
});

describe('reactDevtoolsPlugin', () => {
  const transformIndexHtml = () => {
    const plugin = reactDevtoolsPlugin() as Plugin & {
      transformIndexHtml: () => IndexHtmlTransformResult;
    };

    return plugin.transformIndexHtml();
  };

  it('injects the standalone bridge script in dev', () => {
    expect(transformIndexHtml()).toEqual([
      { attrs: { src: REACT_DEVTOOLS_BRIDGE_URL }, injectTo: 'head-prepend', tag: 'script' },
    ]);
  });

  it('stays out of production builds', () => {
    expect((reactDevtoolsPlugin() as Plugin).apply).toBe('serve');
  });
});
