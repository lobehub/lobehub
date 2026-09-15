import { zstdDecompressSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import {
  candidateDeltaVersions,
  generateZstdPatch,
  logicalKey,
  MIN_PATCH_BYTES,
  pairRendererFiles,
} from '../rendererDelta.mjs';

const file = (filePath, sha256, size) => ({ path: filePath, sha256, size });

describe('logicalKey', () => {
  it('strips the Vite content hash so renamed chunks still pair', () => {
    expect(logicalKey('assets/es-DswPNUym.js')).toBe('assets/es.js');
    expect(logicalKey('i18n/i18n-zh-CN-BnM26YwX.js')).toBe('i18n/i18n-zh-CN.js');
    expect(logicalKey('apps/desktop/index.html')).toBe('apps/desktop/index.html');
  });
});

describe('candidateDeltaVersions', () => {
  it('lists r0 and the last two numbers below current', () => {
    expect(candidateDeltaVersions('r5')).toEqual(['r0', 'r3', 'r4']);
    expect(candidateDeltaVersions('r1')).toEqual(['r0']);
    expect(candidateDeltaVersions('r2')).toEqual(['r0', 'r1']);
  });
});

describe('pairRendererFiles', () => {
  it('copies identical hashes even when the Vite path changed', () => {
    const pairings = pairRendererFiles(
      [file('assets/entry-aaaaaaaa.js', 'aa'.repeat(32), 10)],
      [file('assets/entry-bbbbbbbb.js', 'aa'.repeat(32), 10)],
    );
    expect(pairings).toEqual([
      {
        from: file('assets/entry-aaaaaaaa.js', 'aa'.repeat(32), 10),
        kind: 'copy',
        to: file('assets/entry-bbbbbbbb.js', 'aa'.repeat(32), 10),
      },
    ]);
  });

  it('patches the same relative path when content changed', () => {
    const pairings = pairRendererFiles(
      [file('apps/desktop/index.html', 'aa'.repeat(32), 100)],
      [file('apps/desktop/index.html', 'bb'.repeat(32), 110)],
    );
    expect(pairings[0].kind).toBe('patch');
    expect(pairings[0].from.path).toBe('apps/desktop/index.html');
  });

  it('pairs Vite-renamed chunks with the closest size when hashes differ', () => {
    const pairings = pairRendererFiles(
      [
        file('assets/es-aaaaaaaa.js', '11'.repeat(32), 8_000_000),
        file('assets/es-bbbbbbbb.js', '22'.repeat(32), 2_000_000),
      ],
      [
        file('assets/es-cccccccc.js', '33'.repeat(32), 8_010_000),
        file('assets/es-dddddddd.js', '44'.repeat(32), 1_990_000),
      ],
    );
    const patches = pairings.filter((p) => p.kind === 'patch');
    expect(patches).toHaveLength(2);
    expect(patches.find((p) => p.to.size === 8_010_000).from.size).toBe(8_000_000);
    expect(patches.find((p) => p.to.size === 1_990_000).from.size).toBe(2_000_000);
  });

  it('falls back to a full download when nothing pairs', () => {
    const pairings = pairRendererFiles(
      [file('old.png', 'aa'.repeat(32), 10)],
      [file('brand-new.js', 'bb'.repeat(32), 10)],
    );
    expect(pairings).toEqual([{ kind: 'full', to: file('brand-new.js', 'bb'.repeat(32), 10) }]);
  });
});

describe('generateZstdPatch', () => {
  it('emits a tiny patch when a large file only changes a few bytes', async () => {
    const oldBuf = Buffer.alloc(MIN_PATCH_BYTES * 4, 7);
    const newBuf = Buffer.from(oldBuf);
    newBuf[100] = 9;

    const patch = await generateZstdPatch(oldBuf, newBuf);
    expect(patch).toBeInstanceOf(Buffer);
    expect(patch.byteLength).toBeLessThan(512);
    expect(Buffer.from(zstdDecompressSync(patch, { dictionary: oldBuf }))).toEqual(newBuf);
  });

  it('skips patching files below the size floor', async () => {
    await expect(generateZstdPatch(Buffer.from('old'), Buffer.from('new'))).resolves.toBeNull();
  });
});
