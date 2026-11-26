import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';

import { build } from 'vite';
import { expect, it } from 'vitest';

import { vitePlatformResolve } from './platformResolve';

it.each(['desktop', 'mobile', 'vite'] as const)(
  'lets a %s override reuse base exports without resolving back to itself',
  async (suffix) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'vite-platform-resolve-'));
    try {
      await Promise.all([
        writeFile(path.join(directory, 'entry.ts'), 'export { owner, platform } from "./owner";'),
        writeFile(path.join(directory, 'owner.ts'), 'export const owner = "main";'),
        writeFile(
          path.join(directory, `owner.${suffix}.ts`),
          `export { owner } from "./owner"; export const platform = "${suffix}";`,
        ),
      ]);
      const result = await build({
        build: {
          lib: { entry: path.join(directory, 'entry.ts'), formats: ['cjs'] },
          minify: false,
          write: false,
        },
        configFile: false,
        logLevel: 'silent',
        plugins: [vitePlatformResolve(suffix === 'vite' ? undefined : suffix)],
        root: directory,
      });
      const outputs = Array.isArray(result) ? result : [result];
      const entry = outputs
        .flatMap(({ output }) => output)
        .find((output) => output.type === 'chunk' && output.isEntry);
      if (!entry || entry.type !== 'chunk') throw new Error('Missing fixture entry bundle');
      const exports = {};
      runInNewContext(entry.code, { exports });
      expect(exports).toMatchObject({ owner: 'main', platform: suffix });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  },
);
