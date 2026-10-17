/**
 * Intrinsic pixel size of an image echoed by a tool_result, read straight from
 * the encoded header so the runtime can record it next to the upload without
 * decoding the image. Consumers reserve layout space from it (no jump when the
 * image finishes loading).
 */
export interface ImageDimensions {
  height: number;
  width: number;
}

const readPng = (buf: Buffer): ImageDimensions | undefined => {
  // 8-byte signature, then the IHDR chunk: length(4) type(4) width(4) height(4)
  if (buf.length < 24 || buf.toString('ascii', 12, 16) !== 'IHDR') return;
  return { height: buf.readUInt32BE(20), width: buf.readUInt32BE(16) };
};

const readGif = (buf: Buffer): ImageDimensions | undefined => {
  if (buf.length < 10) return;
  return { height: buf.readUInt16LE(8), width: buf.readUInt16LE(6) };
};

const readJpeg = (buf: Buffer): ImageDimensions | undefined => {
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) return;
    const marker = buf[offset + 1];
    // Fill bytes between markers
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Standalone markers carry no length
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    // SOFn frame headers (excluding DHT/JPG/DAC) hold the frame size
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    offset += 2 + buf.readUInt16BE(offset + 2);
  }
};

const readWebp = (buf: Buffer): ImageDimensions | undefined => {
  if (buf.length < 30 || buf.toString('ascii', 8, 12) !== 'WEBP') return;
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    return { height: buf.readUIntLE(27, 3) + 1, width: buf.readUIntLE(24, 3) + 1 };
  }
  if (chunk === 'VP8L') {
    const bits = buf.readUInt32LE(21);
    return { height: ((bits >> 14) & 0x3f_ff) + 1, width: (bits & 0x3f_ff) + 1 };
  }
  if (chunk === 'VP8 ') {
    return { height: buf.readUInt16LE(28) & 0x3f_ff, width: buf.readUInt16LE(26) & 0x3f_ff };
  }
};

/**
 * Read width/height from a base64 PNG, JPEG, GIF or WebP payload. Detection
 * goes by magic bytes rather than the declared media type, since CLIs do not
 * always label screenshots correctly. Returns `undefined` for anything it
 * cannot parse; callers treat dimensions as best-effort.
 */
export const readImageDimensions = (base64: string): ImageDimensions | undefined => {
  try {
    const buf = Buffer.from(base64, 'base64');
    let dims: ImageDimensions | undefined;

    if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89_50_4e_47) dims = readPng(buf);
    else if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8) dims = readJpeg(buf);
    else if (buf.toString('ascii', 0, 4) === 'GIF8') dims = readGif(buf);
    else if (buf.toString('ascii', 0, 4) === 'RIFF') dims = readWebp(buf);

    if (!dims || dims.width <= 0 || dims.height <= 0) return;
    return dims;
  } catch {
    return;
  }
};
