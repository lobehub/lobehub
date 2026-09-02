import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildRuntimeManifest, collectExternals } from './honoRuntimeDeps.mts';

const testRoots: string[] = [];

afterEach(() => {
  for (const root of testRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('collectExternals', () => {
  it('keeps bare package names and drops builtins, relative and node: specifiers', () => {
    const source = `
      import "./chunks/a.js";
      import "node:fs";
      import { x } from "drizzle-orm/pg-core";
      import * as y from '@aws-sdk/client-s3';
      import "path";
      const z = await import("hono/streaming");
      __require("ffmpeg-static");
      require("replicate");
    `;

    expect(collectExternals([source])).toEqual([
      '@aws-sdk/client-s3',
      'drizzle-orm',
      'ffmpeg-static',
      'hono',
      'replicate',
    ]);
  });
});

describe('buildRuntimeManifest', () => {
  it('pins installed versions, reports missing packages and maps pnpm patches', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'hono-runtime-deps-'));
    testRoots.push(root);
    const distDir = path.join(root, 'apps/server/dist');
    mkdirSync(distDir, { recursive: true });
    writeFileSync(
      path.join(distDir, 'index.js'),
      'import "hono";\nimport "@upstash/qstash";\nimport "buffer.js";\nimport "not-installed";',
    );
    for (const [dirName, name, version] of [
      ['hono', 'hono', '4.1.0'],
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
      "packages:\n  - .\n\nonlyBuiltDependencies:\n  - 'hono'\n  - '@lobehub/editor'\n\noverrides:\n  jose: ^6\n",
    );

    expect(buildRuntimeManifest(distDir, patchesDir, workspaceFile)).toEqual({
      dependencies: {
        '@upstash/qstash': '2.0.0',
        'buffer.js': 'npm:buffer@6.0.3',
        'hono': '4.1.0',
      },
      missing: ['not-installed'],
      onlyBuiltDependencies: ['hono'],
      packageManager: 'pnpm@10.0.0',
      patchedDependencies: { '@upstash/qstash': 'patches/@upstash__qstash.patch' },
    });
  });
});
