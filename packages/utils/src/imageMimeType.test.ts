import { describe, expect, it } from 'vitest';

import {
  inferImageMimeTypeFromBase64,
  inferImageMimeTypeFromBytes,
  inferMimeTypeFromBytes,
  resolveImageMimeTypeFromBase64,
  resolveImageMimeTypeFromBytes,
  resolveMimeTypeFromBytes,
} from './imageMimeType';

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89,
]);
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ';
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const GIF_BYTES = new TextEncoder().encode('GIF89a');
const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const PDF_BYTES = new TextEncoder().encode('%PDF-1.7\n');

describe('imageMimeType', () => {
  it('should infer common image MIME types from bytes', async () => {
    expect(await inferImageMimeTypeFromBytes(PNG_BYTES)).toBe('image/png');
    expect(await inferImageMimeTypeFromBytes(JPEG_BYTES)).toBe('image/jpeg');
    expect(await inferImageMimeTypeFromBytes(GIF_BYTES)).toBe('image/gif');
    expect(await inferImageMimeTypeFromBytes(WEBP_BYTES)).toBe('image/webp');
  });

  it('should return undefined for unrecognized bytes', async () => {
    expect(await inferImageMimeTypeFromBytes(new Uint8Array([0x00, 0x01, 0x02]))).toBeUndefined();
  });

  it('should infer image MIME type from base64 data', async () => {
    expect(await inferImageMimeTypeFromBase64(PNG_BASE64)).toBe('image/png');
  });

  it('should infer non-image MIME types from bytes', async () => {
    expect(await inferMimeTypeFromBytes(PDF_BYTES)).toBe('application/pdf');
  });

  it('should prefer detected bytes over a wrong declared MIME type', async () => {
    expect(await resolveImageMimeTypeFromBytes('image/jpeg', PNG_BYTES)).toBe('image/png');
    expect(await resolveImageMimeTypeFromBase64('image/jpeg', PNG_BASE64)).toBe('image/png');
  });

  it('should fall back to declared image MIME type when bytes are not recognized', async () => {
    expect(
      await resolveImageMimeTypeFromBytes('image/jpeg; charset=utf-8', new Uint8Array([1])),
    ).toBe('image/jpeg');
  });

  it('should not fabricate an image MIME type when no image signal is available', async () => {
    expect(await resolveImageMimeTypeFromBase64('', 'not-valid-base64')).toBeUndefined();
    expect(await resolveImageMimeTypeFromBytes('', PDF_BYTES)).toBeUndefined();
  });

  it('should resolve generic MIME types without defaulting unknown bytes to image/png', async () => {
    expect(await resolveMimeTypeFromBytes('', PDF_BYTES)).toBe('application/pdf');
    expect(await resolveMimeTypeFromBytes('', new Uint8Array([1]))).toBe(
      'application/octet-stream',
    );
  });
});
