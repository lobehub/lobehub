import { describe, expect, it } from 'vitest';

import { readImageDimensions } from './imageDimensions';

const png = (width: number, height: number) => {
  const buf = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
};

const jpeg = (width: number, height: number) => {
  // SOI, an APP0 segment to skip over, then SOF0 carrying the frame size
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
  const sof0 = Buffer.alloc(11);
  sof0.writeUInt16BE(0xff_c0, 0);
  sof0.writeUInt16BE(9, 2);
  sof0[4] = 8;
  sof0.writeUInt16BE(height, 5);
  sof0.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof0]);
};

const gif = (width: number, height: number) => {
  const buf = Buffer.alloc(10);
  buf.write('GIF89a', 0, 'ascii');
  buf.writeUInt16LE(width, 6);
  buf.writeUInt16LE(height, 8);
  return buf;
};

const webpVp8x = (width: number, height: number) => {
  const buf = Buffer.alloc(30);
  buf.write('RIFF', 0, 'ascii');
  buf.write('WEBP', 8, 'ascii');
  buf.write('VP8X', 12, 'ascii');
  buf.writeUIntLE(width - 1, 24, 3);
  buf.writeUIntLE(height - 1, 27, 3);
  return buf;
};

const webpVp8l = (width: number, height: number) => {
  const buf = Buffer.alloc(30);
  buf.write('RIFF', 0, 'ascii');
  buf.write('WEBP', 8, 'ascii');
  buf.write('VP8L', 12, 'ascii');
  buf[20] = 0x2f;
  buf.writeUInt32LE(((height - 1) << 14) | (width - 1), 21);
  return buf;
};

const b64 = (buf: Buffer) => buf.toString('base64');

describe('readImageDimensions', () => {
  it.each([
    ['png', png(1280, 800)],
    ['jpeg', jpeg(1280, 800)],
    ['gif', gif(1280, 800)],
    ['webp VP8X', webpVp8x(1280, 800)],
    ['webp VP8L', webpVp8l(1280, 800)],
  ])('reads %s headers', (_, buf) => {
    expect(readImageDimensions(b64(buf))).toEqual({ height: 800, width: 1280 });
  });

  it('returns undefined for unrecognised or truncated payloads', () => {
    expect(readImageDimensions('AAAA')).toBeUndefined();
    expect(readImageDimensions(b64(png(1280, 800).subarray(0, 16)))).toBeUndefined();
    expect(readImageDimensions('')).toBeUndefined();
  });

  it('rejects zero-sized headers', () => {
    expect(readImageDimensions(b64(png(0, 800)))).toBeUndefined();
  });
});
