import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeCorePack } from '../buildCoreV4.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
let output;
beforeEach(async () => {
  output = await mkdtemp(path.join(tmpdir(), 'core-pack-'));
});
afterEach(async () => {
  await rm(output, { force: true, recursive: true });
});

describe('writeCorePack', () => {
  it('writes lazy frames with the same sorted bytes, hashes and offsets as buffered frames', async () => {
    const entries = new Map([
      ['b', Buffer.from('second')],
      ['a', Buffer.from('first')],
    ]);
    const buffered = await writeCorePack(entries, output);
    const produced = [];
    const lazy = await writeCorePack(
      new Map(
        [...entries].map(([key, bytes]) => [
          key,
          async () => {
            produced.push(key);
            return bytes;
          },
        ]),
      ),
      output,
    );
    const expected = Buffer.from('firstsecond');
    expect(lazy).toEqual(buffered);
    expect(produced).toEqual(['a', 'b']);
    expect(await readFile(path.join(output, lazy.pack.path))).toEqual(expected);
    expect(lazy.pack).toEqual({
      path: `packs/${hash(expected)}.pack`,
      sha256: hash(expected),
      size: 11,
    });
    expect(lazy.index).toEqual({
      a: {
        compressedSha256: hash(Buffer.from('first')),
        length: 5,
        offset: 0,
        packSha256: hash(expected),
      },
      b: {
        compressedSha256: hash(Buffer.from('second')),
        length: 6,
        offset: 5,
        packSha256: hash(expected),
      },
    });
    expect(await readdir(path.join(output, 'packs'))).toEqual([`${hash(expected)}.pack`]);
  });

  it('removes partial packs when a frame producer fails', async () => {
    await expect(
      writeCorePack(
        new Map([
          ['a', Buffer.from('first')],
          [
            'b',
            async () => {
              throw new Error('read failed');
            },
          ],
        ]),
        output,
      ),
    ).rejects.toThrow('read failed');
    expect(await readdir(path.join(output, 'packs'))).toEqual([]);
  });
});
