import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { AgentImageSource } from './types';

export interface NormalizedImage {
  buffer: Buffer;
  mediaType: string;
  /**
   * Filesystem path when one is known. Set when the source was already a
   * path, or after `materializeImageToPath` writes the buffer to a cache dir.
   */
  path?: string;
}

export interface NormalizeImageOptions {
  /**
   * On-disk cache directory for fetched URLs. When set, downloaded bytes are
   * persisted by sha256(id || url) so repeated normalizations of the same
   * image avoid re-fetching. Path-only sources never write here.
   */
  cacheDir?: string;
  /** Override `fetch` (tests / proxy injection). Defaults to the global. */
  fetcher?: typeof fetch;
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const EXT_BY_MEDIA_TYPE: Record<string, string> = {
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/pjpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/x-png': '.png',
};

const MEDIA_TYPE_BY_EXT: Record<string, string> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const sha256Hex = (input: string): string => createHash('sha256').update(input).digest('hex');

const normalizeMediaType = (raw: string | undefined | null): string => {
  if (!raw) return '';
  return raw.split(';')[0]?.trim().toLowerCase() ?? '';
};

const guessMediaTypeFromBuffer = (buffer: Buffer): string | undefined => {
  if (buffer.length >= PNG_SIG.length && buffer.subarray(0, PNG_SIG.length).equals(PNG_SIG)) {
    return 'image/png';
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= 6) {
    const head = buffer.subarray(0, 6).toString('ascii');
    if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return undefined;
};

const guessMediaTypeFromUrl = (url: string): string | undefined => {
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    return MEDIA_TYPE_BY_EXT[ext];
  } catch {
    return undefined;
  }
};

const cacheKeyForUrl = (source: { id?: string; url: string }): string =>
  sha256Hex(source.id || source.url);

const isRecognizedImageMediaType = (mediaType: string): boolean =>
  Boolean(EXT_BY_MEDIA_TYPE[mediaType]);

/**
 * Choose the most trustworthy image media type given the available signals.
 *
 * Generic / non-image header values (`application/octet-stream`, `text/plain`,
 * empty) are common from CDNs that strip extensions and fall back to a default
 * Content-Type — we'd rather sniff the URL extension or PNG/JPEG/GIF/WebP byte
 * signatures than serialize an unrecognized type into a `media_type` field
 * that downstream agents (Claude API) will reject.
 *
 * Resolution order:
 *   1. Header type, only if it's a recognized image/* we know how to extension-map
 *   2. URL extension hint
 *   3. Byte-signature sniff
 *   4. Raw header value as a last resort (preserves whatever the server claimed
 *      so the caller at least sees the original signal)
 *   5. `image/png` fallback
 */
const pickImageMediaType = (
  rawHeaderType: string | undefined | null,
  url: string | undefined,
  buffer: Buffer,
): string => {
  const headerType = normalizeMediaType(rawHeaderType);
  if (headerType && isRecognizedImageMediaType(headerType)) return headerType;

  const urlType = url ? guessMediaTypeFromUrl(url) : undefined;
  if (urlType) return urlType;

  const sniffed = guessMediaTypeFromBuffer(buffer);
  if (sniffed) return sniffed;

  return headerType || 'image/png';
};

const fetchUrlImage = async (
  source: { id?: string; url: string },
  options: NormalizeImageOptions,
): Promise<NormalizedImage> => {
  const fetcher = options.fetcher ?? fetch;
  const cacheDir = options.cacheDir;

  if (cacheDir) {
    const key = cacheKeyForUrl(source);
    const dataPath = path.join(cacheDir, key);
    const metaPath = path.join(cacheDir, `${key}.meta`);
    try {
      const meta = JSON.parse(await readFile(metaPath, 'utf8')) as { mediaType?: string };
      const buffer = await readFile(dataPath);
      const mediaType = pickImageMediaType(meta.mediaType, source.url, buffer);
      return { buffer, mediaType };
    } catch {
      // cache miss — fall through to fetch
    }
  }

  const res = await fetcher(source.url);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch image at ${source.url}: ${res.status} ${res.statusText || ''}`.trim(),
    );
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const mediaType = pickImageMediaType(res.headers.get('content-type'), source.url, buffer);

  if (cacheDir) {
    const key = cacheKeyForUrl(source);
    await mkdir(cacheDir, { recursive: true });
    await writeFile(path.join(cacheDir, key), buffer);
    await writeFile(
      path.join(cacheDir, `${key}.meta`),
      JSON.stringify({ id: source.id, mediaType }),
    );
  }

  return { buffer, mediaType };
};

const readPathImage = async (filePath: string): Promise<NormalizedImage> => {
  const buffer = await readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mediaType =
    MEDIA_TYPE_BY_EXT[ext] || guessMediaTypeFromBuffer(buffer) || 'application/octet-stream';
  return { buffer, mediaType, path: filePath };
};

const decodeBase64Image = (data: string, mediaType: string): NormalizedImage => {
  const buffer = Buffer.from(data, 'base64');
  // The caller's declared mediaType wins only when it's a recognized image
  // type — base64 sources commonly default to `application/octet-stream` from
  // upstream encoders, which would otherwise serialize into a `media_type`
  // that downstream agents (Claude API) reject.
  const resolved = pickImageMediaType(mediaType, undefined, buffer);
  return { buffer, mediaType: resolved };
};

/**
 * Resolve an image source into raw bytes + media type. URL sources may hit a
 * disk cache when `cacheDir` is provided; path sources are read in place;
 * base64 is decoded synchronously.
 */
export const normalizeImage = async (
  source: AgentImageSource,
  options: NormalizeImageOptions = {},
): Promise<NormalizedImage> => {
  switch (source.type) {
    case 'url': {
      return fetchUrlImage(source, options);
    }
    case 'path': {
      return readPathImage(source.path);
    }
    case 'base64': {
      return decodeBase64Image(source.data, source.mediaType);
    }
  }
};

/**
 * Materialize a normalized image to disk so a path-based agent (Codex
 * `--image <file>`) can consume it. If the image already has a `path`, that
 * path is returned as-is. Otherwise the buffer is written into `cacheDir`
 * keyed by content, with an extension derived from the media type — falling
 * back to byte-signature sniffing when the media type is generic
 * (`application/octet-stream` etc.) but the bytes are a recognizable image.
 */
export const materializeImageToPath = async (
  image: NormalizedImage,
  cacheDir: string,
): Promise<string> => {
  if (image.path) return image.path;

  const ext =
    EXT_BY_MEDIA_TYPE[normalizeMediaType(image.mediaType)] ||
    EXT_BY_MEDIA_TYPE[guessMediaTypeFromBuffer(image.buffer) ?? ''];
  if (!ext) {
    throw new Error(`Unsupported image media type for path materialization: ${image.mediaType}`);
  }

  const key = sha256Hex(
    `${image.mediaType}:${image.buffer.length}:${image.buffer.subarray(0, 64).toString('hex')}`,
  );
  const filePath = path.join(cacheDir, `${key}${ext}`);

  try {
    await access(filePath);
  } catch {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(filePath, image.buffer);
  }

  return filePath;
};
