import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { computeMainHash, createMainHash } from '../mainHash.mjs';

const desktopRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const repoRoot = path.dirname(path.dirname(desktopRoot));

describe('mainHash', () => {
  it('hashes emitted main/preload code, not unrelated workspace files', () => {
    const ignoredProbe = path.join(
      repoRoot,
      'packages',
      'types',
      'src',
      `__mainhash-probe-${randomUUID()}.ts`,
    );
    const bundledFile = path.join(desktopRoot, 'src', 'common', 'routes.ts');
    const originalBundledFile = readFileSync(bundledFile, 'utf8');
    const before = computeMainHash();
    writeFileSync(ignoredProbe, 'export type MainHashProbe = string;\n');
    try {
      expect(computeMainHash()).toBe(before);

      writeFileSync(
        bundledFile,
        originalBundledFile.replace('Developer Tools', `Developer Tools ${randomUUID()}`),
      );
      expect(computeMainHash()).not.toBe(before);
    } finally {
      rmSync(ignoredProbe, { force: true });
      writeFileSync(bundledFile, originalBundledFile);
    }
  }, 30_000);

  it('starts a new lineage when bundle metadata changes', () => {
    const base = {
      bundleHashes: [{ hash: 'a'.repeat(64), platform: 'darwin', target: 'main' }],
      cloudRef: 'a'.repeat(40),
      publicKey: 'key-a',
      version: '1.0.0',
    };
    const before = createMainHash(base);

    expect(createMainHash({ ...base, cloudRef: 'b'.repeat(40) })).not.toBe(before);
    expect(createMainHash({ ...base, publicKey: 'key-b' })).not.toBe(before);
    expect(createMainHash({ ...base, version: '1.0.1' })).not.toBe(before);
    expect(
      createMainHash({
        ...base,
        bundleHashes: [{ ...base.bundleHashes[0], hash: 'b'.repeat(64) }],
      }),
    ).not.toBe(before);
  });
});
