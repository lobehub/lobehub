import { zstdCompressSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { applyZstdPatch } from '../zstdPatch';

describe('applyZstdPatch', () => {
  it('reconstructs the new file from a zstd dictionary blob', async () => {
    const oldBuf = Buffer.alloc(64 * 1024, 3);
    const newBuf = Buffer.from(oldBuf);
    newBuf[200] = 42;
    const patch = Buffer.from(zstdCompressSync(newBuf, { dictionary: oldBuf }));

    const rebuilt = await applyZstdPatch(oldBuf, patch);
    expect(Buffer.compare(rebuilt, newBuf)).toBe(0);
  });
});
