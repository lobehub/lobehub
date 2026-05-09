import { open } from 'node:fs/promises';

const SNIFF_BYTES = 8192;
const NON_PRINTABLE_THRESHOLD = 0.3;

export interface BinarySniffResult {
  isBinary: boolean;
  reason?: string;
}

const hasUtf8Bom = (buf: Buffer): boolean =>
  buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;

const hasUtf16Bom = (buf: Buffer): boolean =>
  buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff));

/**
 * Heuristically determine if a buffer looks like binary data.
 *
 * - UTF-8 / UTF-16 BOM → text
 * - Any null byte (and not UTF-16) → binary
 * - More than 30% of decoded chars are control or U+FFFD replacement → binary
 *
 * Note: this only catches truly binary content. Text-encoded blobs (e.g., a
 * single 27KB line of base64) will pass this check — the extension whitelist
 * and the post-load char cap are what stop those.
 */
export const sniffBinaryBuffer = (buffer: Buffer): BinarySniffResult => {
  if (buffer.length === 0) return { isBinary: false };

  if (hasUtf8Bom(buffer) || hasUtf16Bom(buffer)) return { isBinary: false };

  if (buffer.includes(0)) {
    return { isBinary: true, reason: 'contains null byte' };
  }

  const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  if (text.length === 0) return { isBinary: false };

  const REPLACEMENT_CHAR = '�';
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
      reason: `${(ratio * 100).toFixed(1)}% non-printable chars in first ${buffer.length} bytes`,
    };
  }

  return { isBinary: false };
};

/**
 * Read up to the leading 8KB of a file and run the binary heuristic on it.
 */
export const sniffBinaryFile = async (filePath: string): Promise<BinarySniffResult> => {
  const fd = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await fd.read(buffer, 0, SNIFF_BYTES, 0);
    return sniffBinaryBuffer(buffer.subarray(0, bytesRead));
  } finally {
    await fd.close();
  }
};
