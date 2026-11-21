import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_UPLOAD_IMAGE_BYTES,
  readJpegOrientation,
  shrinkImageForUpload,
} from '../shrinkImageForUpload';

const { createFromBuffer } = vi.hoisted(() => ({ createFromBuffer: vi.fn() }));
vi.mock('electron', () => ({ nativeImage: { createFromBuffer } }));

/** A nativeImage stand-in whose encoded size shrinks with the resize edge. */
const fakeImage = (width: number, height: number) => ({
  getSize: () => ({ height, width }),
  resize: vi.fn((size: { height?: number; width?: number }) => {
    const edge = size.width ?? size.height ?? 0;
    const encoded = Buffer.alloc(edge * 1000);
    return { toJPEG: vi.fn(() => encoded), toPNG: vi.fn(() => encoded) };
  }),
});

/** Minimal JPEG with an EXIF APP1 segment carrying `orientation` (big-endian TIFF). */
const jpegWithOrientation = (orientation: number) => {
  const tiff = Buffer.alloc(26);
  tiff.write('MM', 0, 'latin1');
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(1, 8);
  tiff.writeUInt16BE(0x01_12, 10);
  tiff.writeUInt16BE(3, 12);
  tiff.writeUInt32BE(1, 14);
  tiff.writeUInt16BE(orientation, 18);
  const exif = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const header = Buffer.alloc(4);
  header.writeUInt16BE(0xff_e1, 0);
  header.writeUInt16BE(exif.length + 2, 2);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), header, exif, Buffer.from([0xff, 0xda])]);
};

describe('readJpegOrientation', () => {
  it('reads the EXIF orientation tag', () => {
    expect(readJpegOrientation(jpegWithOrientation(6))).toBe(6);
  });

  it('defaults to 1 without EXIF', () => {
    expect(readJpegOrientation(Buffer.from([0xff, 0xd8, 0xff, 0xda]))).toBe(1);
  });
});

describe('shrinkImageForUpload', () => {
  let dir: string;

  beforeEach(async () => {
    createFromBuffer.mockReset();
    dir = await mkdtemp(path.join(tmpdir(), 'shrink-image-test-'));
  });

  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  it('writes a smaller copy with the same file name and removes it on cleanup', async () => {
    const filePath = path.join(dir, 'screenshot.png');
    await writeFile(filePath, Buffer.alloc(9 * 1024 * 1024));
    const image = fakeImage(4000, 2000);
    createFromBuffer.mockReturnValue(image);

    const prepared = await shrinkImageForUpload(filePath, 'image/png');

    expect(prepared.filePath).not.toBe(filePath);
    expect(path.basename(prepared.filePath)).toBe('screenshot.png');
    expect(image.resize).toHaveBeenCalledWith({ quality: 'best', width: 1920 });
    expect((await readFile(prepared.filePath)).length).toBeLessThanOrEqual(MAX_UPLOAD_IMAGE_BYTES);

    await prepared.cleanup();
    expect(existsSync(prepared.filePath)).toBe(false);
  });

  it('uploads images already within the limits as is', async () => {
    const filePath = path.join(dir, 'small.png');
    await writeFile(filePath, Buffer.alloc(1024));
    createFromBuffer.mockReturnValue(fakeImage(800, 600));

    expect((await shrinkImageForUpload(filePath, 'image/png')).filePath).toBe(filePath);
  });

  it('leaves rotated JPEGs to the server, which applies EXIF orientation', async () => {
    const filePath = path.join(dir, 'photo.jpg');
    await writeFile(filePath, jpegWithOrientation(6));

    expect((await shrinkImageForUpload(filePath, 'image/jpeg')).filePath).toBe(filePath);
    expect(createFromBuffer).not.toHaveBeenCalled();
  });

  it('skips formats nativeImage does not re-encode', async () => {
    const filePath = path.join(dir, 'anim.gif');
    expect((await shrinkImageForUpload(filePath, 'image/gif')).filePath).toBe(filePath);
  });
});
