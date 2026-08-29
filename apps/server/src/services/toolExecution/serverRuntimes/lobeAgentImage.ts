import type { MediaFileItem } from '@lobechat/builtin-tool-lobe-agent';
import { imageUrlToBase64, resolveImageMimeTypeFromBytes } from '@lobechat/utils';
import { parseDataUri } from '@lobechat/utils/uriParser';

const SHARP_FORMAT_BY_MIME_TYPE = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

type MultimodalImageMimeType = keyof typeof SHARP_FORMAT_BY_MIME_TYPE;

/** Reject oversized remote responses before buffering and base64 expansion. */
const MAX_MULTIMODAL_IMAGE_DOWNLOAD_BYTES = 20 * 1024 * 1024;

/** Bound retained data URLs across the whole multimodal request. */
const MAX_MULTIMODAL_IMAGE_PREPARATION_BYTES = 20 * 1024 * 1024;

/** Bound all remote image downloads in one preparation pass to a shared deadline. */
const MAX_MULTIMODAL_IMAGE_PREPARATION_MS = 30_000;

/** Share the same decompression-bomb ceiling across validation and transcoding. */
export const MAX_MULTIMODAL_IMAGE_PIXELS = 25_000_000;

const readImage = async (uri: string, signal: AbortSignal) => {
  if (/^data:image\//i.test(uri)) {
    const { base64, mimeType, type } = parseDataUri(uri);
    if (type !== 'base64' || !base64) throw new TypeError('Invalid inline image data');

    const buffer = Buffer.from(base64, 'base64');
    const detectedMimeType = await resolveImageMimeTypeFromBytes(mimeType, buffer);

    return {
      buffer,
      mimeType: detectedMimeType,
      shouldRewriteUri: Boolean(detectedMimeType && detectedMimeType !== mimeType?.toLowerCase()),
    };
  }

  const { base64, mimeType } = await imageUrlToBase64(uri, {
    maxBytes: MAX_MULTIMODAL_IMAGE_DOWNLOAD_BYTES,
    signal,
  });
  return { buffer: Buffer.from(base64, 'base64'), mimeType, shouldRewriteUri: true };
};

const consumePreparationBudget = (usedBytes: number, imageBytes: number) => {
  if (imageBytes > MAX_MULTIMODAL_IMAGE_PREPARATION_BYTES - usedBytes) {
    throw new RangeError('Multimodal images exceed the aggregate preparation byte limit');
  }

  return usedBytes + imageBytes;
};

const transcodeImage = async (buffer: Buffer, targetMimeType: MultimodalImageMimeType) => {
  const { default: sharp } = await import('sharp');
  let image = sharp(buffer, {
    failOn: 'error',
    limitInputPixels: MAX_MULTIMODAL_IMAGE_PIXELS,
  }).rotate();

  // JPEG cannot retain transparency. Flatten onto white so transparent pixels do not
  // become black when the configured visual model only accepts JPEG input.
  if (targetMimeType === 'image/jpeg') {
    image = image.flatten({ background: '#fff' });
  }

  return image.toFormat(SHARP_FORMAT_BY_MIME_TYPE[targetMimeType]).toBuffer();
};

/**
 * Detect images from their actual bytes and transcode unsupported formats before
 * the visual fallback request reaches a provider-specific message builder.
 */
export const normalizeMultimodalImageItems = async (
  items: MediaFileItem[],
  supportedFormats: MultimodalImageMimeType[],
) => {
  const supportedFormatSet = new Set(supportedFormats);
  const targetMimeType = supportedFormats[0];
  if (!targetMimeType) throw new TypeError('At least one multimodal image format is required');

  const normalizedItems: MediaFileItem[] = [];
  const signal = AbortSignal.timeout(MAX_MULTIMODAL_IMAGE_PREPARATION_MS);
  let preparedImageBytes = 0;

  for (const item of items) {
    if (item.type !== 'image') {
      normalizedItems.push(item);
      continue;
    }

    const source = await readImage(item.uri, signal);
    if (source.mimeType && supportedFormatSet.has(source.mimeType as MultimodalImageMimeType)) {
      preparedImageBytes = consumePreparationBudget(preparedImageBytes, source.buffer.byteLength);
      normalizedItems.push(
        source.shouldRewriteUri
          ? {
              ...item,
              uri: `data:${source.mimeType};base64,${source.buffer.toString('base64')}`,
            }
          : item,
      );
      continue;
    }

    const converted = await transcodeImage(source.buffer, targetMimeType);
    preparedImageBytes = consumePreparationBudget(preparedImageBytes, converted.byteLength);
    normalizedItems.push({
      ...item,
      uri: `data:${targetMimeType};base64,${converted.toString('base64')}`,
    });
  }

  return normalizedItems;
};
