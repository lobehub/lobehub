import debug from 'debug';
import pMap from 'p-map';
import sharp from 'sharp';

import type { FileService } from '@/server/services/file';

const log = debug('lobe-server:verify-model-frames');

/**
 * Ceiling on a frame sent inline. Evidence screenshots sit far below it; past it
 * the base64 body (a third larger than the file) would push a multi-frame
 * request toward provider payload limits, so the frame falls back to a link.
 */
export const MAX_INLINE_FRAME_BYTES = 5 * 1024 * 1024;

/**
 * Ceiling on the frames inlined into ONE request, summed over raw file size
 * (~20 MiB once base64-encoded). The per-frame ceiling alone lets a request
 * carrying many frames grow past provider body limits; frames past this budget
 * are linked instead, like an oversized frame.
 */
export const MAX_INLINE_REQUEST_BYTES = 15 * 1024 * 1024;

/** Whether a frame of this size may be sent inline at all. */
export const isInlineableFrameSize = (size?: number | null): size is number =>
  typeof size === 'number' && size > 0 && size <= MAX_INLINE_FRAME_BYTES;

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

/** Frames sampled from an animated GIF into one sheet. */
const GIF_SHEET_MAX_FRAMES = 9;
/** Tile width on a multi-frame sheet; a 3×3 sheet stays under ~1.5k px wide. */
const GIF_SHEET_TILE_WIDTH = 480;
const GIF_SHEET_GAP = 8;
const GIF_SHEET_DECODE_CONCURRENCY = 3;

/**
 * Caption suffix for a GIF the model receives as a frame sheet, so it reads the
 * grid as a timeline rather than as one busy screenshot.
 */
export const GIF_FRAME_SHEET_NOTE =
  'Animated recording shown as evenly spaced frames in playback order, left to right, top to bottom.';

/**
 * Ceiling on a GIF read to build its sheet. The source is only decoded, never
 * sent, so it is not bound by the inline limits; this only keeps one huge
 * recording from being pulled into memory.
 */
export const MAX_GIF_SOURCE_BYTES = 64 * 1024 * 1024;
/** Past this a PNG sheet is re-encoded as JPEG, keeping each sheet small to inline. */
const MAX_GIF_SHEET_PNG_BYTES = 1024 * 1024;

export const isGifStoredFrame = (file: { fileType?: string | null }): boolean =>
  file.fileType?.toLowerCase() === 'image/gif';

/** Whether a frame URL is the sheet a GIF artifact was rendered into. */
export const isGifFrameSheet = (type: string, url: string): boolean =>
  type === 'gif' && /^data:image\/(?:png|jpeg);/.test(url);

/** Bytes a data-URI frame adds to a request once decoded; 0 for a link. */
export const inlinedFrameBytes = (url: string): number =>
  url.startsWith('data:') ? Math.floor(((url.length - url.indexOf(',') - 1) * 3) / 4) : 0;

/**
 * Render a GIF as a PNG sheet of evenly spaced frames.
 *
 * Vision models cannot read an animated GIF: some providers reject the format
 * outright and the rest look at the first frame only. A cold-start recording's
 * first frame is the browser unloading, so a reviewer handed the raw GIF
 * reported "no recording attached" and sent a passing delivery back for
 * another round. A sheet shows the whole recording in one image every vision
 * model accepts.
 */
export const renderGifFrameSheet = async (bytes: Uint8Array): Promise<Buffer | undefined> => {
  const { height, pageHeight, pages = 1, width } = await sharp(bytes).metadata();
  const frameHeight = pageHeight ?? height;
  if (!width || !frameHeight) return;

  const count = Math.min(Math.max(pages, 1), GIF_SHEET_MAX_FRAMES);
  const indices =
    count === 1
      ? [0]
      : Array.from({ length: count }, (_, i) => Math.round((i * (pages - 1)) / (count - 1)));
  const tileWidth = count === 1 ? width : Math.min(width, GIF_SHEET_TILE_WIDTH);
  const tileHeight = Math.max(1, Math.round((frameHeight * tileWidth) / width));
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);

  // Each tile decodes the whole GIF, so keep only a few in flight at once.
  const tiles = await pMap(
    indices,
    (page) =>
      sharp(bytes, { page }).resize(tileWidth, tileHeight, { fit: 'fill' }).png().toBuffer(),
    { concurrency: GIF_SHEET_DECODE_CONCURRENCY },
  );

  return sharp({
    create: {
      background: '#ffffff',
      channels: 3,
      height: rows * tileHeight + (rows - 1) * GIF_SHEET_GAP,
      width: columns * tileWidth + (columns - 1) * GIF_SHEET_GAP,
    },
  })
    .composite(
      tiles.map((input, index) => ({
        input,
        left: (index % columns) * (tileWidth + GIF_SHEET_GAP),
        top: Math.floor(index / columns) * (tileHeight + GIF_SHEET_GAP),
      })),
    )
    .png()
    .toBuffer();
};

const sheetDataUri = async (bytes: Uint8Array): Promise<string | undefined> => {
  const sheet = await renderGifFrameSheet(bytes);
  if (!sheet) return;
  if (sheet.length <= MAX_GIF_SHEET_PNG_BYTES)
    return `data:image/png;base64,${sheet.toString('base64')}`;
  const jpeg = await sharp(sheet).jpeg({ quality: 80 }).toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
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
 * A GIF is always sent as a frame sheet (see {@link renderGifFrameSheet}),
 * whatever its size or the remaining inline budget: a linked GIF is no fallback,
 * because an adapter that downloads it still drops `image/gif`. The sheet is
 * what spends the budget, not the recording it came from.
 *
 * Falls back to the access URL when the frame is too large to inline, is not a
 * recognizable image, or cannot be read.
 */
export const resolveModelReadableFrameUrl = async (
  fileService: FileService,
  file: StoredFrame,
  /** False once the request's inline budget is spent: link the frame instead. */
  inline = true,
): Promise<string> => {
  if (
    isGifStoredFrame(file) &&
    typeof file.size === 'number' &&
    file.size <= MAX_GIF_SOURCE_BYTES
  ) {
    try {
      const sheet = await sheetDataUri(await fileService.getFileByteArray(file.url));
      if (sheet) return sheet;
    } catch (error) {
      log('could not render GIF %s as a frame sheet: %O', file.id, error);
    }
  }
  if (inline && isInlineableFrameSize(file.size)) {
    try {
      const bytes = await fileService.getFileByteArray(file.url);
      const sniffed = sniffImageMimeType(bytes);
      const mimeType = file.fileType?.startsWith('image/') ? file.fileType : sniffed;
      if (sniffed === 'image/gif') {
        // A GIF stored without its MIME type.
        const sheet = await sheetDataUri(bytes);
        if (sheet) return sheet;
      }
      if (mimeType) return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
    } catch (error) {
      log('could not inline frame %s, linking it instead: %O', file.id, error);
    }
  }
  return fileService.getFileAccessUrl({ id: file.id, url: file.url });
};
