import { detectUtf16NoBom } from './detectUtf16';

const NON_PRINTABLE_THRESHOLD = 0.3;

/** Result of heuristic byte inspection, independent of filename and MIME. */
export interface BinarySniffResult {
  /** Whether sampled bytes look binary rather than readable text. */
  isBinary: boolean;
  /** Human-readable explanation when the bytes look binary. */
  reason?: string;
}

const hasUtf8Bom = (buf: Uint8Array): boolean =>
  buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;

const hasUtf16Bom = (buf: Uint8Array): boolean =>
  buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff));

/**
 * Heuristically determine if a buffer looks like binary data.
 *
 * - UTF-8 / UTF-16 BOM → text
 * - UTF-16 detected without BOM (Windows-style exports) → text, decoded for
 *   the printable-ratio check
 * - Any null byte (and not UTF-16) → binary
 * - More than 30% of decoded chars are control or U+FFFD replacement → binary
 *
 * Note: this only catches truly binary content. Text-encoded blobs (e.g., a
 * single 27KB line of base64) will pass this check. The former loader-specific
 * comment described an extension whitelist and post-load cap; callers now
 * own their format policy and size limits.
 *
 * Use when:
 * - Checking raw bytes before attempting text decoding.
 *
 * Expects:
 * - A byte buffer bounded or sampled by the caller.
 *
 * Returns:
 * - A heuristic binary verdict and an optional reason.
 */
export const sniffBinaryBuffer = (buffer: Uint8Array): BinarySniffResult => {
  if (buffer.length === 0) return { isBinary: false };

  if (hasUtf8Bom(buffer) || hasUtf16Bom(buffer)) return { isBinary: false };

  const utf16Variant = detectUtf16NoBom(buffer);
  if (utf16Variant) {
    const text = new TextDecoder(utf16Variant, { fatal: false }).decode(buffer);
    return checkPrintableRatio(text, buffer.length);
  }

  if (buffer.includes(0)) {
    return { isBinary: true, reason: 'contains null byte' };
  }

  const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  return checkPrintableRatio(text, buffer.length);
};

const REPLACEMENT_CHAR = '�';

const checkPrintableRatio = (text: string, sampledBytes: number): BinarySniffResult => {
  if (text.length === 0) return { isBinary: false };

  let suspect = 0;
  for (const ch of text) {
    if (ch === REPLACEMENT_CHAR) {
      suspect++;
      continue;
    }
    const code = ch.codePointAt(0)!;
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      suspect++;
    }
  }

  const ratio = suspect / text.length;
  if (ratio > NON_PRINTABLE_THRESHOLD) {
    return {
      isBinary: true,
      reason: `${(ratio * 100).toFixed(1)}% non-printable chars in first ${sampledBytes} bytes`,
    };
  }

  return { isBinary: false };
};

/**
 * Decode a previewable UTF-8 or UTF-16 text buffer without relying on its filename.
 *
 * Use when:
 * - Showing original uploaded bytes as read-only text.
 *
 * Expects:
 * - A buffer already bounded by the caller's preview size limit.
 *
 * Returns:
 * - Decoded text (including empty text), or null for binary/unsupported encoding.
 */
export const decodeTextBuffer = (buffer: Uint8Array): string | null => {
  if (sniffBinaryBuffer(buffer).isBinary) return null;

  const encoding = hasUtf16Bom(buffer)
    ? buffer[0] === 0xff
      ? 'utf-16le'
      : 'utf-16be'
    : (detectUtf16NoBom(buffer) ?? 'utf8');
  try {
    // Reject invalid encoding rather than replacing original bytes with replacement characters.
    return new TextDecoder(encoding, { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
};
