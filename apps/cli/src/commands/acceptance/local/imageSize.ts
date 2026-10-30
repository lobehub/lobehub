import { closeSync, openSync, readSync } from 'node:fs';

/**
 * Intrinsic pixel size of a PNG, JPEG, GIF or WebP, read from its header.
 * The page reserves each screenshot's aspect ratio before it loads (as the
 * hosted page does from the upload's metadata), so an expanding check never
 * jumps. Anything unrecognized is `null` — the image still renders.
 */
export const readImageSize = (file: string): { height: number; width: number } | null => {
  let fd: number | undefined;
  try {
    fd = openSync(file, 'r');
    const head = Buffer.alloc(64 * 1024);
    const length = readSync(fd, head, 0, head.length, 0);
    return parse(head.subarray(0, length));
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
};

const valid = (width: number, height: number) =>
  width > 0 && height > 0 ? { height, width } : null;

const parse = (buf: Buffer) => {
  // PNG: signature, then the IHDR chunk.
  if (
    buf.length >= 24 &&
    buf.readUInt32BE(0) === 0x89_50_4e_47 &&
    buf.toString('ascii', 12, 16) === 'IHDR'
  )
    return valid(buf.readUInt32BE(16), buf.readUInt32BE(20));

  // GIF: logical screen descriptor.
  if (buf.length >= 10 && buf.toString('ascii', 0, 3) === 'GIF')
    return valid(buf.readUInt16LE(6), buf.readUInt16LE(8));

  // WebP: RIFF container with a VP8 / VP8L / VP8X chunk.
  if (
    buf.length >= 30 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8 ')
      return valid(buf.readUInt16LE(26) & 0x3f_ff, buf.readUInt16LE(28) & 0x3f_ff);
    if (chunk === 'VP8L') {
      const bits = buf.readUInt32LE(21);
      return valid((bits & 0x3f_ff) + 1, ((bits >> 14) & 0x3f_ff) + 1);
    }
    if (chunk === 'VP8X') return valid(buf.readUIntLE(24, 3) + 1, buf.readUIntLE(27, 3) + 1);
  }

  // JPEG: walk the markers to the first start-of-frame.
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) return null;
      const marker = buf[offset + 1]!;
      const size = buf.readUInt16BE(offset + 2);
      const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isFrame) return valid(buf.readUInt16BE(offset + 7), buf.readUInt16BE(offset + 5));
      offset += 2 + size;
    }
  }
  return null;
};
