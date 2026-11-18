// @vitest-environment node
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { optimizeDeps, resolveConfig } from 'vite';
import { expect, it } from 'vitest';

import { sharedOptimizeDeps } from './sharedRendererConfig';

it('initializes the CJK Markdown plugin with its own serializer in the optimized renderer', async () => {
  const cacheDir = await mkdtemp(path.resolve('node_modules/.markdown-test-'));
  try {
    const config = await resolveConfig(
      {
        cacheDir,
        configFile: false,
        logLevel: 'silent',
        optimizeDeps: {
          exclude: sharedOptimizeDeps.exclude,
          include: ['remark-cjk-friendly', 'mdast-util-to-markdown'],
          noDiscovery: true,
          entries: [],
        },
      },
      'serve',
    );
    const result = await optimizeDeps(config, true);
    const entry = result.optimized['remark-cjk-friendly'].file;
    // Load the emitted module in Node, outside Vitest's module transform.
    await expect(
      promisify(execFile)(process.execPath, [
        '--input-type=module',
        '-e',
        `import plugin from ${JSON.stringify(entry)}; plugin.call({ data: () => ({}) });`,
      ]),
    ).resolves.toBeDefined();
  } finally {
    await rm(cacheDir, { force: true, recursive: true });
  }
});
