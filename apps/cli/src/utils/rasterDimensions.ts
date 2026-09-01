export interface RasterDimensions {
  height: number;
  width: number;
}

const valid = (width: number, height: number): RasterDimensions | undefined =>
  width > 0 && height > 0 ? { height, width } : undefined;

/** Read common raster dimensions without pulling a native image dependency into the CLI. */
export const rasterDimensions = (buffer: Buffer): RasterDimensions | undefined => {
  if (
    buffer.length >= 24 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return valid(buffer.readUInt32BE(16), buffer.readUInt32BE(20));
  }

  if (buffer.length >= 10 && ['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))) {
    return valid(buffer.readUInt16LE(6), buffer.readUInt16LE(8));
  }

  if (
    buffer.length >= 30 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    const format = buffer.toString('ascii', 12, 16);
    if (format === 'VP8X') return valid(buffer.readUIntLE(24, 3) + 1, buffer.readUIntLE(27, 3) + 1);
    if (format === 'VP8L' && buffer[20] === 0x2f) {
      const bits = buffer.readUInt32LE(21);
      return valid((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
    }
    if (format === 'VP8 ' && buffer.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a])))
      return valid(buffer.readUInt16LE(26) & 0x3fff, buffer.readUInt16LE(28) & 0x3fff);
  }

  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 8 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1]!;
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2;
        continue;
      }
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2 || offset + length + 2 > buffer.length) return;
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        return valid(buffer.readUInt16BE(offset + 7), buffer.readUInt16BE(offset + 5));
      }
      offset += length + 2;
    }
  }
};
