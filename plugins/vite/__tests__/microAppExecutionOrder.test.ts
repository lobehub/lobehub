// @vitest-environment node
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { build } from 'vite';
import { expect, it, vi } from 'vitest';

import { createAuthRrConfig } from '../../../apps/auth/vite.config.shared.mjs';
import { createShareRrConfig } from '../../../apps/share/vite.config.shared.mjs';
import workbenchConfig from '../../../apps/workbench/vite.config.rr.mjs';

// These deployment plugins are not used by the fixture build. Workbench's
// standalone toolchain is not installed in every host workspace.
vi.mock('@cloudflare/vite-plugin', () => ({ cloudflare: () => ({ name: 'cloudflare-test' }) }));
vi.mock('@react-router/dev/vite', () => ({ reactRouter: () => ({ name: 'react-router-test' }) }));

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const authConfig = createAuthRrConfig({ appRoot: path.join(repoRoot, 'apps/auth'), repoRoot });

it.each([
  { config: authConfig({ command: 'build', mode: 'production' }), name: 'Auth' },
  {
    config: createShareRrConfig({ appRoot: path.join(repoRoot, 'apps/share'), repoRoot }),
    name: 'Share',
  },
  { config: workbenchConfig, name: 'Workbench' },
])('$name initializes editor plugins before a shared chunk consumes them', async ({ config }) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'micro-app-chunk-order-'));

  try {
    // The source graph is acyclic: entry -> editor -> plugins -> tag. Chunking
    // editor and tag together introduces the same cycle as the Share incident.
    await Promise.all([
      writeFile(
        path.join(root, 'entry.js'),
        "export { createPlugins } from './plugins.js'; export { editorPlugins } from './editor.js';",
      ),
      writeFile(
        path.join(root, 'editor.js'),
        "import { createPlugins } from './plugins.js'; export const editorPlugins = [...createPlugins()];",
      ),
      writeFile(
        path.join(root, 'plugins.js'),
        "import { tag } from './tag.js'; export const createPlugins = () => [tag];",
      ),
      writeFile(path.join(root, 'tag.js'), "export const tag = 'reference-tag';"),
    ]);

    const clientBuild = config.environments?.client?.build;

    await build({
      build: {
        ...clientBuild,
        minify: false,
        rolldownOptions: {
          ...clientBuild?.rolldownOptions,
          input: path.join(root, 'entry.js'),
          preserveEntrySignatures: 'allow-extension',
          output: {
            ...clientBuild?.rolldownOptions?.output,
            chunkFileNames: '[name].mjs',
            entryFileNames: 'entry.mjs',
            codeSplitting: {
              groups: [
                {
                  name: (id) => {
                    if (id.endsWith('/plugins.js')) return 'conversation';
                    if (id.endsWith('/editor.js') || id.endsWith('/tag.js')) return 'editor';
                  },
                },
              ],
              includeDependenciesRecursively: false,
            },
          },
        },
      },
      configFile: false,
      logLevel: 'silent',
      root,
    });

    // The conversation is loaded independently by a route. Evaluate it
    // first, as the browser does, rather than relying on the entry's import order.
    const entryUrl = pathToFileURL(path.join(root, 'dist/entry.mjs')).href;
    const conversationUrl = pathToFileURL(path.join(root, 'dist/conversation.mjs')).href;
    const { stdout } = await promisify(execFile)(process.execPath, [
      '--input-type=module',
      '--eval',
      `await import(${JSON.stringify(conversationUrl)});
       const entry = await import(${JSON.stringify(entryUrl)});
       console.log(JSON.stringify([entry.editorPlugins, entry.createPlugins()]));`,
    ]);
    expect(JSON.parse(stdout)).toEqual([['reference-tag'], ['reference-tag']]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
