import debug from 'debug';
import mime from 'mime';
import sharp from 'sharp';

import type { FileService } from '@/server/services/file';

const log = debug('lobe-server:file-ingestion');

// --------------- Constants ---------------

const MAX_IMAGE_SIZE = 1920;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
const COMPRESSIBLE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// --------------- Types ---------------

/**
 * Unified attachment source — the only input step 12 needs.
 * Adapter/platform layer fills buffer + metadata, external URLs just fill url.
 */
export interface AttachmentSource {
  /** Pre-downloaded buffer (from adapter/platform layer) */
  buffer?: Buffer;
  mimeType?: string;
  name?: string;
  size?: number;
  /** External URL (e.g. Discord CDN) — fetched if no buffer */
  url?: string;
}

export interface IngestResult {
  fileId: string;
  isImage: boolean;
  isVideo: boolean;
  key: string;
  resolvedUrl: string;
}

// --------------- Image compression ---------------

/**
 * Compress image to match frontend compressImageFile behavior:
 * - Max 1920px on either dimension
 * - Progressively shrink until <= 5MB
 * - Output PNG (preserves alpha, matches canvas.toDataURL default)
 */
async function compressImage(
  buffer: Buffer,
  mimeType: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  try {
    const metadata = await sharp(buffer).metadata();
    const { width = 0, height = 0 } = metadata;

    if (width <= MAX_IMAGE_SIZE && height <= MAX_IMAGE_SIZE && buffer.length <= MAX_IMAGE_BYTES) {
      return { buffer, mimeType };
    }

    let maxSize = MAX_IMAGE_SIZE;
    let result: Buffer;
    do {
      result = await sharp(buffer)
        .resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();
      maxSize = Math.round(maxSize * 0.8);
    } while (result.length > MAX_IMAGE_BYTES && maxSize > 100);

    log(
      'compressed image %dx%d (%d bytes) → %d bytes',
      width,
      height,
      buffer.length,
      result.length,
    );

    return { buffer: result, mimeType: 'image/png' };
  } catch (error) {
    log('image compression failed, using original: %s', error);
    return { buffer, mimeType };
  }
}

// --------------- Public API ---------------

/**
 * Unified file ingestion: normalize → compress → upload → create record.
 *
 * Accepts both buffer (bot adapter) and URL (external platforms) inputs.
 * Applies the same MIME correction, image compression, and metadata as the UI upload path.
 */
export async function ingestAttachment(
  source: AttachmentSource,
  fileService: FileService,
  userId: string,
): Promise<IngestResult> {
  log(
    'ingestAttachment: input name=%s, mimeType=%s, hasBuffer=%s, hasUrl=%s, size=%s',
    source.name,
    source.mimeType,
    !!source.buffer,
    !!source.url,
    source.size,
  );

  let buffer: Buffer;
  let mimeType = source.mimeType || 'application/octet-stream';

  // 1. Resolve buffer
  if (source.buffer) {
    buffer = source.buffer;
  } else if (source.url) {
    const response = await fetch(source.url);
    if (!response.ok) {
      throw new Error(`Failed to fetch attachment: ${response.status} ${response.statusText}`);
    }
    buffer = Buffer.from(await response.arrayBuffer());

    // Use response header if more specific than what we have
    const headerType = response.headers.get('content-type');
    if (headerType && headerType !== 'application/octet-stream') {
      mimeType = headerType;
    }
  } else {
    throw new Error('AttachmentSource must have either buffer or url');
  }

  // 2. MIME correction from filename
  if (mimeType === 'application/octet-stream' && source.name) {
    const inferred = mime.getType(source.name);
    if (inferred) {
      log('ingestAttachment: inferred mimeType from filename: %s -> %s', source.name, inferred);
      mimeType = inferred;
    }
  }

  // 3. Compress images
  const isImage = COMPRESSIBLE_TYPES.has(mimeType);
  if (isImage) {
    const compressed = await compressImage(buffer, mimeType);
    buffer = compressed.buffer;
    mimeType = compressed.mimeType;
  }

  // Videos are not compressed, but we still need a resolved URL so the
  // MessageContentProcessor can pass the video to vision/video-capable models.
  const isVideo = !isImage && mimeType.startsWith('video/');

  log(
    'ingestAttachment: classified name=%s, finalMimeType=%s, isImage=%s, isVideo=%s, bufferSize=%d',
    source.name,
    mimeType,
    isImage,
    isVideo,
    buffer.length,
  );

  // 4. Upload + create record
  const ext = source.name?.split('.').pop() || 'bin';
  const { nanoid } = await import('@lobechat/utils');
  const pathname = `files/${userId}/${nanoid()}/${source.name || `file.${ext}`}`;
  const { fileId, key } = await fileService.uploadFromBuffer(buffer, mimeType, pathname);

  // 5. Resolve full URL for images and videos (presigned or public)
  const resolvedUrl = isImage || isVideo ? await fileService.getFullFileUrl(key) : '';

  log(
    'ingestAttachment: uploaded fileId=%s, key=%s, resolvedUrl=%s',
    fileId,
    key,
    resolvedUrl ? 'set' : '(empty)',
  );

  return { fileId, isImage, isVideo, key, resolvedUrl };
}
