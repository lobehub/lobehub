import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { applyZstdPatch } from '../zstdPatch';

const hasZstd = (() => {
  try {
    execFileSync('zstd', ['-V'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasZstd)('applyZstdPatch', () => {
  it('reconstructs the new file from a zstd --patch-from blob', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zstd-patch-'));
    const oldPath = path.join(dir, 'old.bin');
    const newPath = path.join(dir, 'new.bin');
    const patchPath = path.join(dir, 'patch.zst');
    const oldBuf = Buffer.alloc(64 * 1024, 3);
    const newBuf = Buffer.from(oldBuf);
    newBuf[200] = 42;
    writeFileSync(oldPath, oldBuf);
    writeFileSync(newPath, newBuf);
    execFileSync('zstd', ['--patch-from', oldPath, '-19', '-q', '-f', newPath, '-o', patchPath]);

    const rebuilt = await applyZstdPatch(oldBuf, readFileSync(patchPath));
    expect(Buffer.compare(rebuilt, newBuf)).toBe(0);
  });
});
