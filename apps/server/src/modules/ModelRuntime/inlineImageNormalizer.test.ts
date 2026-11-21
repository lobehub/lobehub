import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { sharpInlineImageNormalizer } from './inlineImageNormalizer';

const MB = 1024 * 1024;
const LIMITS = { maxBase64Bytes: 5 * MB, maxLongEdge: 2000 };

const solidPng = async (width: number, height: number) =>
  (
    await sharp({
      create: { background: '#3366ff', channels: 3, height, width },
    })
      .png()
      .toBuffer()
  ).toString('base64');

/** Random pixels barely compress, so the PNG is far over the byte cap. */
const noisePng = async (width: number, height: number) => {
  const pixels = Buffer.alloc(width * height * 3);
  // Seeded xorshift keeps the fixture identical across runs.
  let state = 0x9e3779b9;
  for (let i = 0; i < pixels.length; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    pixels[i] = state & 0xff;
  }
  return (
    await sharp(pixels, { raw: { channels: 3, height, width } })
      .png()
      .toBuffer()
  ).toString('base64');
};

describe('sharpInlineImageNormalizer', () => {
  it('returns images within the limits untouched', async () => {
    const image = { base64: await solidPng(800, 600), mimeType: 'image/png' };
    expect(await sharpInlineImageNormalizer(image, LIMITS)).toBe(image);
  });

  it('scales an oversized image to the long-edge cap and keeps its format', async () => {
    const result = await sharpInlineImageNormalizer(
      { base64: await solidPng(3000, 1500), mimeType: 'image/png' },
      LIMITS,
    );
    const metadata = await sharp(Buffer.from(result.base64, 'base64')).metadata();
    expect(result.mimeType).toBe('image/png');
    expect([metadata.width, metadata.height]).toEqual([2000, 1000]);
  });

  it('re-encodes to WebP under the byte cap, deterministically', async () => {
    const image = { base64: await noisePng(1800, 1800), mimeType: 'image/png' };
    expect(image.base64.length).toBeGreaterThan(5 * MB);

    const first = await sharpInlineImageNormalizer(image, LIMITS);
    const second = await sharpInlineImageNormalizer(image, LIMITS);

    expect(first.mimeType).toBe('image/webp');
    expect(first.base64.length).toBeLessThanOrEqual(5 * MB);
    expect(second.base64).toBe(first.base64);
  });
});
