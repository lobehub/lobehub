import type { MediaFileItem } from '@lobechat/builtin-tool-lobe-agent';
import { imageUrlToBase64 } from '@lobechat/utils';
import { parseDataUri } from '@lobechat/utils/uriParser';
import mime from 'mime';

const SHARP_FORMAT_BY_MIME_TYPE = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

type MultimodalImageMimeType = keyof typeof SHARP_FORMAT_BY_MIME_TYPE;

const normalizeMimeType = (mimeType?: string | null) => {
  const normalized = mimeType?.toLowerCase();
  return normalized === 'image/jpg' ? 'image/jpeg' : normalized;
};

const getDeclaredMimeType = (uri: string) => {
  if (/^data:image\//i.test(uri)) {
    return normalizeMimeType(parseDataUri(uri).mimeType);
  }

  try {
    return normalizeMimeType(mime.getType(new URL(uri).pathname));
  } catch {
    return undefined;
  }
};

const readImage = async (uri: string) => {
  if (/^data:image\//i.test(uri)) {
    const { base64, mimeType, type } = parseDataUri(uri);
    if (type !== 'base64' || !base64) throw new TypeError('Invalid inline image data');

    return { base64, buffer: Buffer.from(base64, 'base64'), mimeType: normalizeMimeType(mimeType) };
  }

  const { base64, mimeType } = await imageUrlToBase64(uri);
  return { base64, buffer: Buffer.from(base64, 'base64'), mimeType: normalizeMimeType(mimeType) };
};

/** Transcode images, using white for alpha pixels because JPEG cannot preserve transparency. */
const transcodeImage = async (buffer: Buffer, targetMimeType: MultimodalImageMimeType) => {
  const { default: sharp } = await import('sharp');
  const image = sharp(buffer).rotate();

  if (targetMimeType === 'image/jpeg') image.flatten({ background: '#fff' });

  return image.toFormat(SHARP_FORMAT_BY_MIME_TYPE[targetMimeType]).toBuffer();
};

/** Convert only image formats that the configured visual fallback does not accept. */
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

    const declaredMimeType = getDeclaredMimeType(item.uri);
    if (declaredMimeType && supportedFormatSet.has(declaredMimeType as MultimodalImageMimeType)) {
      normalizedItems.push(item);
      continue;
    }

    const source = await readImage(item.uri);
    if (
      !declaredMimeType &&
      source.mimeType &&
      supportedFormatSet.has(source.mimeType as MultimodalImageMimeType)
    ) {
      normalizedItems.push({
        ...item,
        uri: `data:${source.mimeType};base64,${source.base64}`,
      });
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
