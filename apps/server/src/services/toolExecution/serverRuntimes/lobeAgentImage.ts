import type { MediaFileItem } from '@lobechat/builtin-tool-lobe-agent';
import { imageUrlToBase64, resolveImageMimeTypeFromBytes } from '@lobechat/utils';
import { parseDataUri } from '@lobechat/utils/uriParser';

const SHARP_FORMAT_BY_MIME_TYPE = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

type MultimodalImageMimeType = keyof typeof SHARP_FORMAT_BY_MIME_TYPE;

const readImage = async (uri: string) => {
  if (/^data:image\//i.test(uri)) {
    const { base64, mimeType, type } = parseDataUri(uri);
    if (type !== 'base64' || !base64) throw new TypeError('Invalid inline image data');

    const buffer = Buffer.from(base64, 'base64');
    const detectedMimeType = await resolveImageMimeTypeFromBytes(mimeType, buffer);

    return { buffer, mimeType: detectedMimeType };
  }

  const { base64, mimeType } = await imageUrlToBase64(uri);
  return { buffer: Buffer.from(base64, 'base64'), mimeType };
};

const transcodeImage = async (buffer: Buffer, targetMimeType: MultimodalImageMimeType) => {
  const { default: sharp } = await import('sharp');
  let image = sharp(buffer, { failOn: 'error' }).rotate();

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

  for (const item of items) {
    if (item.type !== 'image') {
      normalizedItems.push(item);
      continue;
    }

    const source = await readImage(item.uri);
    if (source.mimeType && supportedFormatSet.has(source.mimeType as MultimodalImageMimeType)) {
      normalizedItems.push(item);
      continue;
    }

    const converted = await transcodeImage(source.buffer, targetMimeType);
    normalizedItems.push({
      ...item,
      uri: `data:${targetMimeType};base64,${converted.toString('base64')}`,
    });
  }

  return normalizedItems;
};
