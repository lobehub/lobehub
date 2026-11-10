import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readImageSize } from './imageSize';
import { pngHeader } from './testUtils';

let dir: string;
const file = (name: string, content: Buffer) => {
  const target = path.join(dir, name);
  writeFileSync(target, content);
  return target;
};

describe('readImageSize', () => {
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'lh-image-size-'));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  it('reads PNG, GIF and JPEG headers', () => {
    expect(readImageSize(file('a.png', pngHeader(1280, 720)))).toEqual({
      height: 720,
      width: 1280,
    });

    const gif = Buffer.alloc(13);
    gif.write('GIF89a', 0, 'ascii');
    gif.writeUInt16LE(320, 6);
    gif.writeUInt16LE(240, 8);
    expect(readImageSize(file('b.gif', gif))).toEqual({ height: 240, width: 320 });

    // SOI, an APP0 segment, then a baseline frame header.
    const jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x90,
      0x02, 0x58, 0x03, 0x01, 0x22, 0x00,
    ]);
    expect(readImageSize(file('c.jpg', jpeg))).toEqual({ height: 400, width: 600 });
  });

  it('answers null for anything it cannot read', () => {
    expect(readImageSize(file('d.png', Buffer.from('not an image')))).toBeNull();
    expect(readImageSize(path.join(dir, 'missing.png'))).toBeNull();
  });
});
