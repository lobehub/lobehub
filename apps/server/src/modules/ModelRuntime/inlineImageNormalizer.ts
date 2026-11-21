import type { InlineImageNormalizer } from '@lobechat/model-runtime';

const OUTPUT_FORMATS = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

/**
 * WebP fallbacks for an image that still exceeds the byte cap after resizing,
 * largest and best first. Fixed steps keep the output deterministic, so the same
 * source always yields the same bytes and the cached prompt prefix stays valid.
 */
const SHRINK_LADDER: Array<[scale: number, quality: number]> = [
  [1, 85],
  [1, 70],
  [0.75, 70],
  [0.5, 65],
  [0.35, 60],
];

/**
 * Resizes images the context builders inline as base64 so they fit the provider's
 * dimension and per-image size limits. Images already within the limits are
 * returned untouched, so their request bytes are the same as before.
 *
 * sharp is imported lazily to keep the native dependency out of module graphs
 * that never inline an oversized image.
 */
export const sharpInlineImageNormalizer: InlineImageNormalizer = async (image, limits) => {
  const source = Buffer.from(image.base64, 'base64');
  const { default: sharp } = await import('sharp');
  const { width = 0, height = 0 } = await sharp(source).metadata();
  if (!width || !height) return image;

  const longEdge = Math.max(width, height);
  if (longEdge <= limits.maxLongEdge && image.base64.length <= limits.maxBase64Bytes) return image;

  const fitEdge = Math.min(longEdge, limits.maxLongEdge);
  const encode = (edge: number, format: 'jpeg' | 'png' | 'webp', quality?: number) =>
    sharp(source)
      .rotate()
      .resize(edge, edge, { fit: 'inside', withoutEnlargement: true })
      .toFormat(format, quality ? { quality } : undefined)
      .toBuffer();

  const format = OUTPUT_FORMATS[image.mimeType as keyof typeof OUTPUT_FORMATS] ?? 'png';
  let result = await encode(fitEdge, format);
  let mimeType = `image/${format}`;

  for (const [scale, quality] of SHRINK_LADDER) {
    if (Math.ceil(result.length / 3) * 4 <= limits.maxBase64Bytes) break;
    result = await encode(Math.round(fitEdge * scale), 'webp', quality);
    mimeType = 'image/webp';
  }

  return { base64: result.toString('base64'), mimeType };
};
