import { stat } from 'node:fs/promises';
import path from 'node:path';

import type {
  ImageUploadFailure,
  ReadFileParams,
  ReadImageFileResult,
  UploadedImageRecord,
} from '../types';
import { resolveAgainstCwd } from './expandTilde';

/**
 * Image extensions `readFile` uploads to file storage instead of refusing as
 * binary. The runtime can then route the image to downstream media analysis
 * rather than hitting "Unsupported binary file".
 *
 * AVIF is included for Analyze Media, whose request-boundary normalization
 * converts unsupported image formats for its fallback vision model. This does
 * not imply native AVIF support across providers. SVG is intentionally absent:
 * it's text, and reading the source is more useful to the model than a
 * rasterization we can't produce here.
 */
const LOCAL_IMAGE_EXT_TO_MIME: Record<string, string> = {
  avif: 'image/avif',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** Refuse to load image bytes beyond this size — providers reject them anyway. */
export const MAX_IMAGE_READ_BYTES = 10 * 1024 * 1024;

/** MIME type of a path `readFile` treats as an image, or `undefined` for any other file. */
export const getLocalImageMimeType = (filePath: string): string | undefined =>
  LOCAL_IMAGE_EXT_TO_MIME[path.extname(filePath).toLowerCase().replace('.', '')];

export interface ReadLocalImageFileOptions {
  /**
   * Classifies an upload failure. The default only recognises the server's
   * `storage_block:<reason>` code; hosts that know more about their transport
   * (the desktop parses the CLI child's stderr) pass their own.
   */
  classifyUploadError?: (error: unknown) => ImageUploadFailure;
  /**
   * Uploads the image at an absolute path to file storage. Returns `undefined`
   * when the host declines, which degrades to a placeholder.
   */
  upload: (filePath: string) => Promise<UploadedImageRecord | undefined>;
}

const STORAGE_BLOCK_PATTERN = /storage_block:[\w-]+/;

/** Default {@link ReadLocalImageFileOptions.classifyUploadError}. */
export const classifyImageUploadError = (error: unknown): ImageUploadFailure => {
  const message = error instanceof Error ? error.message : String(error);
  const storageBlock = message.match(STORAGE_BLOCK_PATTERN);
  if (storageBlock) return { kind: 'storage_quota', reason: storageBlock[0] };

  return { kind: 'unknown', reason: message || 'unknown error' };
};

/**
 * Model-facing explanation of an upload failure; follows "upload unavailable — ".
 * Says why the model cannot see the image and what it should do next.
 */
export const formatImageUploadFailure = ({ kind, reason }: ImageUploadFailure): string => {
  switch (kind) {
    case 'storage_quota': {
      // Every later image read fails the same way, so the model must stop the
      // batch and hand the fix to the user instead of retrying image by image.
      return `the user's LobeHub file storage is full or blocked by their plan (${reason}), so the model cannot view this image. Retrying will not help, and every other image read fails the same way until storage is available: do not read more images now. Tell the user, so they can delete files they no longer need from their LobeHub resource library or upgrade their plan, then read the images again`;
    }
    case 'network': {
      return `network error while uploading (${reason}), already retried, so the model cannot view this image. It may work if the file is read again later`;
    }
    case 'auth': {
      return `the app is not signed in to LobeHub (${reason}), so the model cannot view this image`;
    }
    default: {
      return `${reason}; the model cannot view this image`;
    }
  }
};

/**
 * Read an image path for the agent: upload the bytes and return a durable
 * `{ imageFileId, imageUrl }` reference instead of text. Bytes never enter the
 * tool result; the MessageContent processor turns the URL into an `image_url`
 * part for the LLM. Failures degrade to an `[Image: name]` placeholder that
 * tells the model why it cannot see the image, instead of failing the read.
 *
 * Callers check {@link getLocalImageMimeType} first and fall back to
 * `readLocalFile` for every other path.
 */
export async function readLocalImageFile(
  { cwd, path: rawPath }: ReadFileParams,
  mimeType: string,
  { classifyUploadError = classifyImageUploadError, upload }: ReadLocalImageFileOptions,
): Promise<ReadImageFileResult> {
  const filePath = resolveAgainstCwd(rawPath, cwd) ?? rawPath;
  const filename = path.basename(filePath);

  const buildResult = (
    content: string,
    extra: Partial<ReadImageFileResult> = {},
  ): ReadImageFileResult => ({
    charCount: 0,
    content,
    createdTime: new Date(),
    fileType: mimeType,
    filename,
    isImage: true,
    lineCount: 0,
    loc: [0, 0],
    modifiedTime: new Date(),
    totalCharCount: 0,
    totalLineCount: 0,
    ...extra,
  });

  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch (error) {
    return buildResult(`Error accessing or processing file: ${(error as Error).message}`);
  }

  if (!fileStat.isFile()) {
    return buildResult(`Error: Not a regular file: ${filePath}`);
  }

  if (fileStat.size > MAX_IMAGE_READ_BYTES) {
    return buildResult(
      `Error: Image file is too large to preview (${fileStat.size} bytes, limit ${MAX_IMAGE_READ_BYTES}).`,
    );
  }

  const times = { createdTime: fileStat.birthtime, modifiedTime: fileStat.mtime };

  let record: UploadedImageRecord | undefined;
  try {
    record = await upload(filePath);
  } catch (error) {
    const uploadError = classifyUploadError(error);
    return buildResult(
      `[Image: ${filename}] (upload unavailable — ${formatImageUploadFailure(uploadError)})`,
      { ...times, uploadError },
    );
  }

  if (record?.url) {
    return buildResult(`[Image: ${filename}]`, {
      ...times,
      imageFileId: record.id,
      imageUrl: record.url,
    });
  }

  return buildResult(
    `[Image: ${filename}] (upload unavailable — the model cannot view this image)`,
    times,
  );
}
