import path from 'node:path';

import { sniffBinaryBuffer } from '@lobechat/file-loaders';

const EXPORT_MIME_MAP: Record<string, string> = {
  '.bash': 'text/plain; charset=utf-8',
  '.c': 'text/plain; charset=utf-8',
  '.cpp': 'text/plain; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.dockerfile': 'text/plain; charset=utf-8',
  '.fish': 'text/plain; charset=utf-8',
  '.gif': 'image/gif',
  '.go': 'text/plain; charset=utf-8',
  '.graphql': 'application/graphql; charset=utf-8',
  '.h': 'text/plain; charset=utf-8',
  '.hpp': 'text/plain; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.jsx': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.mdx': 'text/markdown; charset=utf-8',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.py': 'text/plain; charset=utf-8',
  '.rs': 'text/plain; charset=utf-8',
  '.sh': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.toml': 'application/toml; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8',
  '.tsx': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.yaml': 'application/yaml; charset=utf-8',
  '.yml': 'application/yaml; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.zsh': 'text/plain; charset=utf-8',
};

/**
 * Lookup table for renderer-bundled assets. The set of extensions is closed
 * (whatever `electron-vite` produces under the renderer dir), so a whitelist
 * is appropriate here.
 */
export const getExportMimeType = (filePath: string): string | undefined => {
  const ext = path.extname(filePath).toLowerCase();
  return EXPORT_MIME_MAP[ext];
};

// Image formats we render natively in the preview pane but don't ship as
// bundled assets — kept separate from EXPORT_MIME_MAP so RendererProtocolManager
// stays minimal.
const PREVIEW_IMAGE_MIME_MAP: Record<string, string> = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
};

const SNIFF_BYTES = 8192;
const TEXT_FALLBACK_MIME = 'text/plain; charset=utf-8';
const BINARY_FALLBACK_MIME = 'application/octet-stream';

/**
 * Resolve the MIME type to serve for a local file preview.
 *
 * 1. Known source/image extensions go through the whitelist for a stable,
 *    accurate type (e.g. `.ts` → `text/plain`, not `video/mp2t`).
 * 2. Anything else — no extension, `.cjs` / `.mjs`, `.lock`, `.editorconfig`,
 *    an arbitrary user file — falls through to a binary sniff on the first
 *    8KB. Text → `text/plain`, otherwise `application/octet-stream`. This
 *    removes the need to maintain an exhaustive extension allow-list.
 */
export const resolveLocalFileMimeType = (filePath: string, buffer: Buffer): string => {
  const ext = path.extname(filePath).toLowerCase();
  const fromWhitelist = EXPORT_MIME_MAP[ext] ?? PREVIEW_IMAGE_MIME_MAP[ext];
  if (fromWhitelist) return fromWhitelist;

  const { isBinary } = sniffBinaryBuffer(buffer.subarray(0, SNIFF_BYTES));
  return isBinary ? BINARY_FALLBACK_MIME : TEXT_FALLBACK_MIME;
};
