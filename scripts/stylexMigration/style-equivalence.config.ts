import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

import type { ProjectConfig } from '../../packages/style-equivalence/src/config';
import { cssModulesAdapter } from '../../packages/style-equivalence/src/extract/adapters/cssModules';
import { emotionStaticAdapter } from '../../packages/style-equivalence/src/extract/adapters/emotionStatic';
import { globalCssAdapter } from '../../packages/style-equivalence/src/extract/adapters/globalCss';
import { stylexAdapter } from '../../packages/style-equivalence/src/extract/adapters/stylex';
import type * as LobeUiImportsModule from '../../plugins/vite/lobeUiImports';
import type * as StylexModule from '../../plugins/vite/stylex';
import { workspaceExports } from './verification/build/fixtureResolvers';

const fromRevision = async <T>(root: string, file: string) => {
  const target = existsSync(path.join(root, file))
    ? path.join(root, file)
    : path.resolve(import.meta.dirname, '../..', file);
  return (await import(pathToFileURL(target).href)) as T;
};

const lenient = (plugin: Plugin): Plugin => ({
  ...plugin,
  async resolveId(...args) {
    try {
      return await (plugin.resolveId as (...input: unknown[]) => unknown).apply(this, args);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('WORKSPACE_EXPORT_UNSUPPORTED'))
        return undefined;
      throw error;
    }
  },
});

const config: ProjectConfig = {
  adapters: [emotionStaticAdapter, stylexAdapter, cssModulesAdapter, globalCssAdapter],
  aliases: { '@/': 'src/' },
  conditions: { themeAttribute: 'data-theme', themes: ['light', 'dark'], widths: [375, 1280] },
  cxFallback: { name: 'cx', source: '@lobehub/ui' },
  hostWrapper: 'styleEquivalenceHost.tsx',
  layoutComponents: ['Flexbox', 'Center', 'Block'],
  vite: async (root) => {
    const { stylexPlugin } = await fromRevision<typeof StylexModule>(
      root,
      'plugins/vite/stylex.ts',
    );
    const { lobeUiImports } = await fromRevision<typeof LobeUiImportsModule>(
      root,
      'plugins/vite/lobeUiImports.ts',
    );
    return {
      alias: [
        { find: /^@\/const\//, replacement: path.join(root, 'packages/const/src/') },
        { find: '@', replacement: path.join(root, 'src') },
      ],
      dedupe: ['react', 'react-dom', '@emotion/react', '@emotion/css', '@stylexjs/stylex'],
      define: {
        '__CI__': 'false',
        '__DEV__': 'false',
        '__ELECTRON__': 'false',
        '__MOBILE__': 'false',
        '__REACT_SCAN__': 'false',
        '__TEST__': 'false',
        'process.env': '{}',
      },
      plugins: [
        lenient(await workspaceExports(root)),
        stylexPlugin({ overlaySrcDirs: [path.join(root, 'src')] }),
        react(),
        ...lobeUiImports(),
      ],
    };
  },
};

export default config;
