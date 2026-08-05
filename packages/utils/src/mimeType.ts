import mime from 'mime';

// Extensions where mime-db has no entry (or a wrong one) but a specific
// text/x-* mime helps downstream language detection.
const CUSTOM_MIME_TYPES: Record<string, string> = {
  '.clj': 'text/x-clojure',
  '.ex': 'text/x-elixir',
  '.exs': 'text/x-elixir',
  '.go': 'text/x-go',
  '.hs': 'text/x-haskell',
  '.kt': 'text/x-kotlin',
  '.lua': 'text/x-lua',
  '.pl': 'text/x-perl',
  '.py': 'text/x-python',
  '.r': 'text/x-r',
  '.rb': 'text/x-ruby',
  '.rs': 'text/x-rust',
  '.scala': 'text/x-scala',
  '.svelte': 'text/x-svelte',
  '.swift': 'text/x-swift',
  '.vue': 'text/x-vue',
};

const SNIFF_BYTES = 8192;
const TEXT_FALLBACK_MIME = 'text/plain; charset=utf-8';
const BINARY_FALLBACK_MIME = 'application/octet-stream';

// mime.getType returns bare types (e.g. 'application/json'); text-like
// responses need an explicit charset for the renderer.
const TEXT_MIME_PATTERN =
  /^(?:text\/|application\/(?:ecmascript|graphql|javascript|json|toml|xhtml\+xml|xml|yaml))/;

const withCharset = (mimeType: string): string =>
  TEXT_MIME_PATTERN.test(mimeType) && !mimeType.includes('charset=')
    ? `${mimeType}; charset=utf-8`
    : mimeType;

const getExtension = (filePath: string): string => {
  const fileName = filePath.replace(/^.*[/\\]/s, '');
  const dotIndex = fileName.lastIndexOf('.');

  return dotIndex > 0 ? fileName.slice(dotIndex).toLowerCase() : '';
};

const lookupExtensionMime = (filePath: string): string | null => {
  const ext = getExtension(filePath);
  return CUSTOM_MIME_TYPES[ext] ?? mime.getType(filePath);
};

// Trimmed binary sniff: any null byte in the first 8KB → binary. Enough to
// disambiguate text sources from binary payloads for the downgrade rule.
const looksBinary = (buffer: Uint8Array): boolean => {
  const limit = Math.min(buffer.byteLength, SNIFF_BYTES);
  for (let i = 0; i < limit; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
};

/**
 * Sync extension-only lookup. Falls back to `application/octet-stream` for
 * unknown extensions. Use this when a file buffer isn't available (URL input,
 * TRPC payload, filename-only records).
 */
export const getMimeType = (filePath: string): string => {
  return lookupExtensionMime(filePath) || BINARY_FALLBACK_MIME;
};

/**
 * Extension-only lookup with charset appended for text mimes. Returns
 * `undefined` for unknown extensions so the caller can leave `Content-Type`
 * unset instead of forcing a download via `application/octet-stream`.
 * Use this for HTTP responses over known-closed asset sets (Vite output,
 * bundled resources, …).
 */
export const tryGetMimeType = (filePath: string): string | undefined => {
  const detected = lookupExtensionMime(filePath);
  return detected ? withCharset(detected) : undefined;
};

/**
 * Resolve a MIME type from a file path and its content buffer.
 *
 * Extension alone is ambiguous — `.ts` is `video/mp2t` in mime-db and also a
 * TypeScript source; a `.pdf` header is printable ASCII for the first bytes.
 * Trust magic bytes first, then fall back to the extension, and let a text
 * sniff overrule mime-db when the two disagree.
 *
 * 1. `fileTypeFromBuffer()` — magic-byte detection. Authoritative when it
 *    matches: real MPEG-TS media wins here regardless of extension.
 * 2. Extension lookup (custom map + `mime.getType`) — the only signal for
 *    text formats file-type can't fingerprint (json/css/md/svg/…).
 *    - Text mime → use as-is (with charset appended).
 *    - Binary mime + non-empty buffer that sniffs as text → downgrade to
 *      text/plain. Saves TypeScript source from mime-db's `video/mp2t`.
 *    - Otherwise → use the extension mime.
 * 3. No extension mapping → sniff-based fallback.
 */
export const resolveMimeType = async (filePath: string, buffer: Uint8Array): Promise<string> => {
  const { fileTypeFromBuffer } = await import('file-type');
  const detected = await fileTypeFromBuffer(buffer);
  if (detected?.mime) return detected.mime;

  const isBinary = looksBinary(buffer);
  const fromExtension = lookupExtensionMime(filePath);
  if (fromExtension) {
    if (TEXT_MIME_PATTERN.test(fromExtension)) return withCharset(fromExtension);
    if (buffer.byteLength > 0 && !isBinary) return TEXT_FALLBACK_MIME;
    return fromExtension;
  }

  return isBinary ? BINARY_FALLBACK_MIME : TEXT_FALLBACK_MIME;
};
