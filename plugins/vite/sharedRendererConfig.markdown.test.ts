// @vitest-environment node
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { optimizeDeps, resolveConfig } from 'vite';
import { expect, it } from 'vitest';

import { sharedOptimizeDeps } from './sharedRendererConfig';

it('initializes CJK markdown after pre-bundling with its own mdast version', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'markdown-prebundle-'));
  try {
    const modules = path.join(root, 'node_modules');
    const fixture = path.join(modules, 'markdown-fixture');
    await mkdir(fixture, { recursive: true });
    for (const name of ['unified', 'remark-cjk-friendly', 'mdast-util-to-markdown']) {
      await symlink(
        path.resolve(import.meta.dirname, '../../node_modules', name),
        path.join(modules, name),
      );
    }
    await writeFile(
      path.join(fixture, 'package.json'),
      JSON.stringify({ name: 'markdown-fixture', type: 'module', exports: './index.js' }),
    );
    await writeFile(
      path.join(fixture, 'index.js'),
      `import { unified } from 'unified';
import remarkCjkFriendly from 'remark-cjk-friendly';
export const createProcessor = () => unified().use(remarkCjkFriendly).freeze();`,
    );
    const config = await resolveConfig(
      {
        cacheDir: path.join(root, '.vite'),
        configFile: false,
        logLevel: 'silent',
        optimizeDeps: {
          exclude: sharedOptimizeDeps.exclude,
          include: ['markdown-fixture'],
          noDiscovery: true,
        },
        root,
      },
      'serve',
    );
    const metadata = await optimizeDeps(config, true);
    const { createProcessor } = await import(
      /* @vite-ignore */ pathToFileURL(metadata.optimized['markdown-fixture'].file).href
    );
    expect(createProcessor().data()).toMatchObject({
      toMarkdownExtensions: [
        {
          handlers: { emphasis: expect.any(Function), strong: expect.any(Function) },
        },
      ],
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
