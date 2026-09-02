import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildRuntimeManifest } from './honoRuntimeDeps.mts';

const testRoots: string[] = [];

afterEach(() => {
  for (const root of testRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('buildRuntimeManifest', () => {
  it('pins installed externals, skips missing ones and carries pnpm settings over', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'hono-runtime-deps-'));
    testRoots.push(root);
    const distDir = path.join(root, 'apps/server/dist');
    mkdirSync(distDir, { recursive: true });
    for (const [dirName, name, version] of [
      ['sharp', 'sharp', '0.34.5'],
      ['@upstash/qstash', '@upstash/qstash', '2.0.0'],
      ['buffer.js', 'buffer', '6.0.3'],
    ]) {
      const dir = path.join(root, 'node_modules', dirName);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version }));
    }
    const patchesDir = path.join(root, 'patches');
    mkdirSync(patchesDir);
    writeFileSync(path.join(patchesDir, '@upstash__qstash.patch'), '');
    writeFileSync(path.join(patchesDir, 'unrelated.patch'), '');
    const workspaceFile = path.join(root, 'pnpm-workspace.yaml');
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ packageManager: 'pnpm@10.0.0' }),
    );
    writeFileSync(
      workspaceFile,
      "packages:\n  - .\n\nonlyBuiltDependencies:\n  - 'sharp'\n  - '@lobehub/editor'\n\noverrides:\n  jose: ^6\n",
    );

    expect(
      buildRuntimeManifest(
        ['sharp', 'buffer.js', '@upstash/qstash', 'pg-native'],
        distDir,
        patchesDir,
        workspaceFile,
      ),
    ).toEqual({
      dependencies: {
        '@upstash/qstash': '2.0.0',
        'buffer.js': 'npm:buffer@6.0.3',
        'sharp': '0.34.5',
      },
      missing: ['pg-native'],
      onlyBuiltDependencies: ['sharp'],
      packageManager: 'pnpm@10.0.0',
      patchedDependencies: { '@upstash/qstash': 'patches/@upstash__qstash.patch' },
    });
  });
});
