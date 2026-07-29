import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { resolveMimeType } from '@lobechat/utils/mimeType';

import type { LocalFilePreview, LocalFilePreviewResult, LocalFilePreviewUrlParams } from './types';

const TEXT_PREVIEW_MIME_TYPES = new Set([
  'application/graphql',
  'application/javascript',
  'application/json',
  'application/markdown',
  'application/toml',
  'application/xml',
  'application/yaml',
  'text/markdown',
  'text/mdx',
  'text/x-markdown',
]);

const normalizeContentType = (contentType: string): string => contentType.split(';')[0].trim();

const isTextPreviewMimeType = (contentType: string): boolean => {
  const bare = normalizeContentType(contentType);
  return bare.startsWith('text/') || TEXT_PREVIEW_MIME_TYPES.has(bare);
};

const serializePreviewFile = (buffer: Buffer, contentType: string): LocalFilePreview => {
  if (contentType.startsWith('image/')) {
    return { base64: buffer.toString('base64'), contentType, type: 'image' };
  }
  if (isTextPreviewMimeType(contentType)) {
    return { content: buffer.toString('utf8'), contentType, type: 'text' };
  }
  if (normalizeContentType(contentType) === 'application/pdf') {
    return { contentType, type: 'pdf' };
  }
  if (contentType.startsWith('video/')) {
    return { contentType, type: 'video' };
  }
  return { contentType, type: 'binary' };
};

/** Resolve the real path, tolerating non-existent targets. */
const safeRealpath = async (target: string): Promise<string> => {
  try {
    return await realpath(target);
  } catch {
    return path.resolve(target);
  }
};

/**
 * Portable file preview for the CLI (and any non-desktop device): read the file
 * from disk and serialize it. The file must resolve inside `workingDirectory` —
 * the same containment guarantee the desktop's preview-protocol manager
 * enforces — so a remote caller can't read arbitrary paths on the device.
 *
 * `accept: 'image'` restricts the preview to image content types.
 */
export const defaultGetLocalFilePreview = async (
  params: LocalFilePreviewUrlParams,
): Promise<LocalFilePreviewResult> => {
  const { accept, path: filePath, workingDirectory } = params;

  try {
    if (!workingDirectory) {
      return { error: 'Missing working directory', success: false };
    }

    const realRoot = await safeRealpath(workingDirectory);
    const realFile = await safeRealpath(filePath);
    const withinRoot = realFile === realRoot || realFile.startsWith(`${realRoot}${path.sep}`);
    if (!withinRoot) {
      return { error: 'File is outside the approved workspace', success: false };
    }

    const stats = await stat(realFile);
    if (!stats.isFile()) {
      return { error: 'Path is not a file', success: false };
    }

    const buffer = await readFile(realFile);
    const contentType = await resolveMimeType(realFile, buffer);
    if (accept === 'image' && !contentType.startsWith('image/')) {
      return { error: 'File is not an image', success: false };
    }

    return { preview: serializePreviewFile(buffer, contentType), success: true };
  } catch (error) {
    return { error: (error as Error).message, success: false };
  }
};
