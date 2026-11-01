import { createHash } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { build } from 'vite';

/** Bundled into the source snapshot, then executed as a separate Node process. */
const main = async () => {
  const root = await realpath(process.cwd());
  const source = process.argv[2];
  const relativeTools = process.argv[3];
  if (!source || path.isAbsolute(source) || source.split('/').includes('..'))
    throw new Error('INVALID_COMPONENT_SOURCE');
  const component = await realpath(path.join(root, source));
  if (!component.startsWith(root + path.sep)) throw new Error('COMPONENT_SOURCE_ESCAPE');
  if (!relativeTools || path.isAbsolute(relativeTools) || relativeTools.split('/').includes('..'))
    throw new Error('INVALID_FIXTURE_TOOLS');
  const tools = await realpath(path.join(root, relativeTools));
  if (!tools.startsWith(path.join(root, '.stylex-tools') + path.sep))
    throw new Error('FIXTURE_TOOLS_ESCAPE');
  // These are the version's actual compiler/import plugins, not checkout plugins.
  const { stylexPlugin } = await import(
    pathToFileURL(path.join(tools, 'compiler/stylex.mjs')).href
  );
  const { lobeUiImports } = await import(
    pathToFileURL(path.join(tools, 'compiler/lobeUiImports.mjs')).href
  );
  const modules = new Set<string>();
  const observer = JSON.parse(await readFile(path.join(tools, 'style-bindings.json'), 'utf8')) as {
    composition: { edits: Array<{ start: number; end: number; text: string }> };
    observerExport: string;
    sourceHash: string;
  };
  const bindingObserver: Plugin = {
    name: 'verification-readonly-binding-observer',
    enforce: 'pre',
    transform(code, id) {
      if (id.split('?')[0] !== component) return;
      if (code.includes('__styleVerificationBindings'))
        throw new Error('STYLE_BINDING_OBSERVER_NAME_COLLISION');
      if (createHash('sha256').update(code).digest('hex') !== observer.sourceHash)
        throw new Error('STYLE_BINDING_OBSERVER_SOURCE_DRIFT');
      let rightBoundary = code.length;
      for (const edit of [...observer.composition.edits].sort((a, b) => b.start - a.start)) {
        if (
          !Number.isSafeInteger(edit.start) ||
          !Number.isSafeInteger(edit.end) ||
          edit.start < 0 ||
          edit.end < edit.start ||
          edit.end > rightBoundary
        )
          throw new Error('STYLE_BINDING_OBSERVER_EDIT_RANGE_INVALID');
        code = code.slice(0, edit.start) + edit.text + code.slice(edit.end);
        rightBoundary = edit.start;
      }
      return { code: code + observer.observerExport, map: null };
    },
  };
  const audit: Plugin = {
    name: 'verification-module-provenance',
    async load(id) {
      if (id.startsWith('\0') || id.startsWith('virtual:')) return;
      const file = id.split('?')[0];
      if (!path.isAbsolute(file)) return;
      const resolved = await realpath(file);
      if (!resolved.startsWith(root + path.sep)) throw new Error(`BUILD_MODULE_ESCAPE:${resolved}`);
      modules.add(path.relative(root, resolved));
    },
  };
  await build({
    base: './',
    build: {
      cssMinify: false,
      minify: false,
      outDir: path.join(tools, 'dist'),
      reportCompressedSize: false,
      chunkSizeWarningLimit: 10_000,
    },
    configFile: false,
    define: {
      '__CI__': 'false',
      '__DEV__': 'false',
      '__ELECTRON__': 'false',
      '__MOBILE__': 'false',
      '__REACT_SCAN__': 'false',
      '__TEST__': 'false',
      'process.env': '{}',
    },
    logLevel: 'error',
    plugins: [
      audit,
      bindingObserver,
      stylexPlugin({ overlaySrcDirs: [path.join(root, 'src')] }),
      react(),
      ...lobeUiImports(),
    ],
    publicDir: false,
    resolve: {
      alias: [
        { find: 'verification:component', replacement: path.join(tools, 'host/component.ts') },
        {
          find: 'verification:locale/chat',
          replacement: path.join(root, 'packages/locales/src/default/chat.ts'),
        },
        {
          find: 'verification:locale/components',
          replacement: path.join(root, 'packages/locales/src/default/components.ts'),
        },
        { find: /^@\/const\//, replacement: path.join(root, 'packages/const/src/') },
        { find: '@', replacement: path.join(root, 'src') },
      ],
      dedupe: ['react', 'react-dom', '@emotion/react', '@emotion/css', '@stylexjs/stylex'],
    },
    root: path.join(tools, 'host'),
  });
  if (!modules.has(source)) throw new Error('COMPONENT_NOT_IN_BUILD_GRAPH');
  await writeFile(path.join(tools, 'build-modules.json'), JSON.stringify([...modules].sort()), {
    flag: 'wx',
  });
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 3;
});
