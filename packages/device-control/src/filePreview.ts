import { copyFile, mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { WORKSPACE_HTML_ARTIFACT_MAX_FILE_BYTES } from '@lobechat/html-artifact/limits';
import { getMimeType, resolveMimeType } from '@lobechat/utils/mimeType';

import type {
  CopyAssetForPublishParams,
  CopyAssetForPublishResult,
  ExternalAssetForPublishParams,
  ExternalAssetForPublishResult,
  LocalFilePreview,
  LocalFilePreviewResult,
  LocalFilePreviewUrlParams,
} from './types';

/** Device-side ceiling for a single publish asset, shared with the Electron main process. */
export const EXTERNAL_PUBLISH_ASSET_MAX_BYTES = WORKSPACE_HTML_ARTIFACT_MAX_FILE_BYTES;

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

/** Binary documents the in-app portal can preview (or offer to download). */
const DOCUMENT_PREVIEW_MIME_TYPES = new Set([
  'application/msword',
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

/**
 * Documents above this raw size fall back to the content-less `binary` / `pdf`
 * variants: base64 inflates the payload ~4/3 and it must fit in a single
 * Gateway RPC response.
 */
const MAX_DOCUMENT_PREVIEW_BYTES = 20 * 1024 * 1024;

const serializePreviewFile = (buffer: Buffer, contentType: string): LocalFilePreview => {
  if (contentType.startsWith('image/')) {
    return { base64: buffer.toString('base64'), contentType, type: 'image' };
  }
  if (isTextPreviewMimeType(contentType)) {
    return { content: buffer.toString('utf8'), contentType, type: 'text' };
  }
  if (
    DOCUMENT_PREVIEW_MIME_TYPES.has(normalizeContentType(contentType)) &&
    buffer.byteLength <= MAX_DOCUMENT_PREVIEW_BYTES
  ) {
    return { base64: buffer.toString('base64'), contentType, type: 'document' };
  }
  if (normalizeContentType(contentType) === 'application/pdf') {
    return { contentType, type: 'pdf' };
  }
  if (contentType.startsWith('video/')) {
    return { contentType, type: 'video' };
  }
  return { contentType, type: 'binary' };
};

// Edited-file records can carry `~`-prefixed paths (the file tools expand the
// home directory at write time) — expand them before resolving so the preview
// targets the file that was actually written, not `<cwd>/~/...`.
// Mirrors local-file-shell's `expandTilde`: slice off the full `~/` / `~\`
// prefix so the separator never survives as a literal filename character on
// POSIX.
const expandHomePath = (target: string): string => {
  if (target === '~') return homedir();
  if (target.startsWith('~/') || target.startsWith('~\\')) {
    return path.join(homedir(), target.slice(2));
  }
  return target;
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

    const realRoot = await safeRealpath(expandHomePath(workingDirectory));
    const realFile = await safeRealpath(expandHomePath(filePath));
    const withinRoot = realFile === realRoot || realFile.startsWith(`${realRoot}${path.sep}`);
    if (!withinRoot) {
      return { error: 'File is outside the approved workspace', success: false };
    }

    const stats = await stat(realFile);
    if (!stats.isFile()) {
      return { error: 'Path is not a file', success: false };
    }

    // Oversized documents can only ever produce the content-less fallback —
    // detect them by extension so the daemon never reads a 100 MB report into
    // memory just to discard it.
    if (stats.size > MAX_DOCUMENT_PREVIEW_BYTES) {
      const extensionType = normalizeContentType(getMimeType(realFile));
      if (DOCUMENT_PREVIEW_MIME_TYPES.has(extensionType)) {
        if (accept === 'image') {
          return { error: 'File is not an image', success: false };
        }
        return {
          preview:
            extensionType === 'application/pdf'
              ? { contentType: extensionType, type: 'pdf' }
              : { contentType: extensionType, type: 'binary' },
          success: true,
        };
      }
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

export const defaultReadExternalAssetForPublish = async ({
  path: filePath,
  workingDirectory,
}: ExternalAssetForPublishParams): Promise<ExternalAssetForPublishResult> => {
  try {
    if (!workingDirectory) return { error: 'Missing working directory', success: false };
    const expandedPath = expandHomePath(filePath);
    const resolvedPath = path.isAbsolute(expandedPath)
      ? expandedPath
      : path.resolve(expandHomePath(workingDirectory), expandedPath);
    const realFile = await realpath(resolvedPath);
    const stats = await stat(realFile);
    if (!stats.isFile()) return { error: 'Path is not a file', success: false };
    // Reject by size before reading: the renderer's limit check only runs after
    // the whole file has been read and base64-encoded into a gateway response.
    if (stats.size > EXTERNAL_PUBLISH_ASSET_MAX_BYTES) {
      return { error: 'File is too large to publish', success: false };
    }

    const buffer = await readFile(realFile);
    return {
      base64: buffer.toString('base64'),
      contentType: await resolveMimeType(realFile, buffer),
      success: true,
    };
  } catch (error) {
    return { error: (error as Error).message, success: false };
  }
};

const resolvePublishPath = (target: string, workingDirectory: string): string => {
  const expanded = expandHomePath(target);
  return path.isAbsolute(expanded)
    ? expanded
    : path.resolve(expandHomePath(workingDirectory), expanded);
};

// The destination usually does not exist yet, so realpath the nearest existing
// ancestor and re-append the missing tail; otherwise a symlinked tmp root
// (`/var` → `/private/var`) never matches the realpath'd workspace root.
const realpathForCreate = async (target: string): Promise<string> => {
  const missing: string[] = [];
  let current = path.resolve(target);
  for (;;) {
    try {
      return path.join(await realpath(current), ...missing);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.join(current, ...missing);
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
};

export const defaultCopyAssetForPublish = async ({
  from,
  to,
  workingDirectory,
}: CopyAssetForPublishParams): Promise<CopyAssetForPublishResult> => {
  try {
    if (!workingDirectory) return { error: 'Missing working directory', success: false };
    const realRoot = await safeRealpath(expandHomePath(workingDirectory));
    const target = await realpathForCreate(resolvePublishPath(to, workingDirectory));
    if (!target.startsWith(`${realRoot}${path.sep}`)) {
      return { error: 'Destination is outside the approved workspace', success: false };
    }

    const realSource = await realpath(resolvePublishPath(from, workingDirectory));
    const stats = await stat(realSource);
    if (!stats.isFile()) return { error: 'Path is not a file', success: false };
    if (stats.size > EXTERNAL_PUBLISH_ASSET_MAX_BYTES) {
      return { error: 'File is too large to publish', success: false };
    }

    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(realSource, target);
    return { success: true };
  } catch (error) {
    return { error: (error as Error).message, success: false };
  }
};
