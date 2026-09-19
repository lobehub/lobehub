import debug from 'debug';

import type { FileService } from '@/server/services/file';

const log = debug('lobe-server:verify-model-frames');

/**
 * Ceiling on a frame sent inline. Evidence screenshots sit far below it; past it
 * the base64 body (a third larger than the file) would push a multi-frame
 * request toward provider payload limits, so the frame falls back to a link.
 */
export const MAX_INLINE_FRAME_BYTES = 5 * 1024 * 1024;

interface StoredFrame {
  fileType?: string | null;
  id: string;
  size?: number | null;
  url: string;
}

/** Recognize the image formats a vision model accepts from their leading bytes. */
const sniffImageMimeType = (bytes: Uint8Array): string | undefined => {
  const startsWith = (...signature: number[]) =>
    signature.every((byte, index) => bytes[index] === byte);
  if (startsWith(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (
    startsWith(0x52, 0x49, 0x46, 0x46) &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  )
    return 'image/webp';
};

/**
 * The URL a judging model is given for a stored evidence frame.
 *
 * The frame is read from our own storage and sent as a data URI. A link makes
 * the provider download the file itself, which is the one step of the request
 * we do not control: a bucket on localhost or a private network is unreachable
 * from the provider, and the model call fails with "Error while downloading
 * file" on every attempt, however many times the review is retried.
 *
 * Falls back to the access URL when the frame is too large to inline, is not a
 * recognizable image, or cannot be read.
 */
export const resolveModelReadableFrameUrl = async (
  fileService: FileService,
  file: StoredFrame,
): Promise<string> => {
  if (typeof file.size === 'number' && file.size > 0 && file.size <= MAX_INLINE_FRAME_BYTES) {
    try {
      const bytes = await fileService.getFileByteArray(file.url);
      const mimeType = file.fileType?.startsWith('image/')
        ? file.fileType
        : sniffImageMimeType(bytes);
      if (mimeType) return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
    } catch (error) {
      log('could not inline frame %s, linking it instead: %O', file.id, error);
    }
  }
  return fileService.getFileAccessUrl({ id: file.id, url: file.url });
};
