import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { nativeImage } from 'electron';

/** Same limits as chat uploads (`packages/utils/src/compressImage.ts`). */
export const MAX_UPLOAD_IMAGE_EDGE = 1920;
export const MAX_UPLOAD_IMAGE_BYTES = 3 * 1024 * 1024;

const JPEG_QUALITY = 85;

export interface PreparedImageUpload {
  /** Removes the temporary copy, if one was written. */
  cleanup: () => Promise<void>;
  filePath: string;
}

/**
 * EXIF orientation of a JPEG, or 1 when absent. nativeImage decodes without
 * applying it, so re-encoding a rotated photo would bake in the wrong rotation.
 */
export const readJpegOrientation = (buffer: Buffer): number => {
  if (buffer.readUInt16BE(0) !== 0xff_d8) return 1;
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    const marker = buffer.readUInt16BE(offset);
    const length = buffer.readUInt16BE(offset + 2);
    if (marker === 0xff_e1 && buffer.toString('latin1', offset + 4, offset + 10) === 'Exif\0\0') {
      const tiff = offset + 10;
      const little = buffer.toString('latin1', tiff, tiff + 2) === 'II';
      const u16 = (at: number) => (little ? buffer.readUInt16LE(at) : buffer.readUInt16BE(at));
      const u32 = (at: number) => (little ? buffer.readUInt32LE(at) : buffer.readUInt32BE(at));
      const ifd = tiff + u32(tiff + 4);
      const entries = u16(ifd);
      for (let i = 0; i < entries; i++) {
        const entry = ifd + 2 + i * 12;
        if (u16(entry) === 0x01_12) return u16(entry + 8);
      }
      return 1;
    }
    // Start of scan: image data follows, no more metadata segments.
    if (marker === 0xff_da) return 1;
    offset += 2 + length;
  }
  return 1;
};

const keepOriginal = (filePath: string): PreparedImageUpload => ({
  cleanup: async () => {},
  filePath,
});

/**
 * Shrinks a PNG or JPEG that `readFile` is about to upload to the chat upload
 * limits, so a large local screenshot does not travel as a multi-megabyte
 * original on every later model request. Writes the result to a temporary file
 * with the same name; any other image, or one already within the limits, is
 * uploaded as is.
 */
export const shrinkImageForUpload = async (
  filePath: string,
  mimeType: string,
): Promise<PreparedImageUpload> => {
  if (mimeType !== 'image/png' && mimeType !== 'image/jpeg') return keepOriginal(filePath);

  try {
    const source = await readFile(filePath);
    if (mimeType === 'image/jpeg' && readJpegOrientation(source) !== 1) {
      return keepOriginal(filePath);
    }

    const image = nativeImage.createFromBuffer(source);
    const { width, height } = image.getSize();
    if (!width || !height) return keepOriginal(filePath);

    const longEdge = Math.max(width, height);
    if (longEdge <= MAX_UPLOAD_IMAGE_EDGE && source.length <= MAX_UPLOAD_IMAGE_BYTES) {
      return keepOriginal(filePath);
    }

    let edge = Math.min(longEdge, MAX_UPLOAD_IMAGE_EDGE);
    let output: Buffer;
    do {
      const resized = image.resize(
        width >= height ? { quality: 'best', width: edge } : { height: edge, quality: 'best' },
      );
      output = mimeType === 'image/jpeg' ? resized.toJPEG(JPEG_QUALITY) : resized.toPNG();
      edge = Math.round(edge * 0.8);
    } while (output.length > MAX_UPLOAD_IMAGE_BYTES && edge > 100);

    if (output.length >= source.length) return keepOriginal(filePath);

    const dir = await mkdtemp(path.join(tmpdir(), 'lobehub-read-image-'));
    const target = path.join(dir, path.basename(filePath));
    await writeFile(target, output);
    return { cleanup: () => rm(dir, { force: true, recursive: true }), filePath: target };
  } catch {
    return keepOriginal(filePath);
  }
};
