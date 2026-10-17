import { open, readFile } from 'node:fs/promises';

import { detectUtf16NoBom } from '@lobechat/utils/detectUtf16';

/**
 * Byte encoding of a text file, as detected by {@link decodeTextBuffer}.
 * `utf-16be` has no `Buffer` encoding name, so re-encoding goes through
 * {@link encodeTextBuffer} rather than `Buffer.from(content, encoding)`.
 */
export type TextFileEncoding = 'utf8' | 'utf-16le' | 'utf-16be';

/**
 * Byte-order mark a file started with. UTF-16 BOMs are consumed while
 * decoding but must be re-applied when writing the file back — BOM-less
 * UTF-16 is misread as ANSI by Notepad and PowerShell 5.1.
 */
export type TextFileBom = 'utf8' | 'utf-16le' | 'utf-16be' | null;

/** A decoded text file plus everything needed to write it back in its original encoding. */
export interface DecodedTextFile {
  /** BOM the file started with, re-applied by {@link encodeTextBuffer}. */
  bom: TextFileBom;
  /** File content as text, BOM stripped. */
  content: string;
  /** How the bytes (after any BOM) were decoded, and must be re-encoded. */
  encoding: TextFileEncoding;
}

/**
 * Decode a text buffer with automatic encoding detection: UTF-8, UTF-16LE,
 * and UTF-16BE via BOM, a heuristic fallback for UTF-16 without BOM (common
 * in some Windows exports), then UTF-8.
 *
 * Mirrors `TextLoader`'s `readTextFile` detection exactly. The logic is
 * deliberately duplicated instead of shared: in the single-file CLI bundle a
 * module reachable from both the eager text loader and a lazily chunked
 * importer can lose its initialization at startup (lobehub/lobehub#19934),
 * so the read path must not grow an import on the write path. Keep the two
 * in sync.
 */
export const decodeTextBuffer = (buffer: Uint8Array): DecodedTextFile => {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return {
      bom: 'utf-16le',
      content: new TextDecoder('utf-16le').decode(buffer.subarray(2)),
      encoding: 'utf-16le',
    };
  }

  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return {
      bom: 'utf-16be',
      content: new TextDecoder('utf-16be').decode(buffer.subarray(2)),
      encoding: 'utf-16be',
    };
  }

  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return {
      bom: 'utf8',
      content: new TextDecoder('utf8').decode(buffer.subarray(3)),
      encoding: 'utf8',
    };
  }

  const variant = detectUtf16NoBom(buffer);
  if (variant) {
    return { bom: null, content: new TextDecoder(variant).decode(buffer), encoding: variant };
  }

  return { bom: null, content: new TextDecoder('utf8').decode(buffer), encoding: 'utf8' };
};

/** {@link decodeTextBuffer} over a file on disk. */
export const decodeTextFile = async (filePath: string): Promise<DecodedTextFile> =>
  decodeTextBuffer(await readFile(filePath));

const HEADER_SAMPLE_BYTES = 512;

/** Encoding and BOM of an existing file, the write-path counterpart of {@link DecodedTextFile}. */
export interface TextFileFormat {
  bom: TextFileBom;
  encoding: TextFileEncoding;
}

/**
 * Format of an existing file, detected from its first 512 bytes — the
 * light-touch counterpart of {@link decodeTextFile} for write paths that
 * only need to know how to encode, without reading the whole file.
 */
export const detectTextFileFormat = async (filePath: string): Promise<TextFileFormat> => {
  const handle = await open(filePath, 'r');
  try {
    const { buffer, bytesRead } = await handle.read({
      buffer: Buffer.alloc(HEADER_SAMPLE_BYTES),
      length: HEADER_SAMPLE_BYTES,
      position: 0,
    });
    const { bom, encoding } = decodeTextBuffer(buffer.subarray(0, bytesRead));
    return { bom, encoding };
  } finally {
    await handle.close();
  }
};

/** `Buffer.from(content, 'utf-16be')` — Node has no such encoding name, so swap the LE pairs. */
const encodeUtf16be = (content: string): Buffer => {
  const buffer = Buffer.from(content, 'utf16le');
  for (let i = 0; i + 1 < buffer.length; i += 2) {
    const byte = buffer[i];
    buffer[i] = buffer[i + 1];
    buffer[i + 1] = byte;
  }
  return buffer;
};

const BOM_BYTES: Record<Exclude<TextFileBom, null>, [number, number] | [number, number, number]> = {
  'utf-16be': [0xfe, 0xff],
  'utf-16le': [0xff, 0xfe],
  'utf8': [0xef, 0xbb, 0xbf],
};

/**
 * Re-encode text decoded by {@link decodeTextBuffer} back to the file's
 * original bytes, restoring the BOM the file carried. Swapping the high/low
 * bytes of every 16-bit unit keeps surrogate pairs intact.
 */
export const encodeTextBuffer = (
  content: string,
  encoding: TextFileEncoding,
  bom: TextFileBom = null,
): Buffer => {
  const body =
    encoding === 'utf-16le'
      ? Buffer.from(content, 'utf16le')
      : encoding === 'utf-16be'
        ? encodeUtf16be(content)
        : Buffer.from(content, 'utf8');

  return bom === null ? body : Buffer.concat([Buffer.from(BOM_BYTES[bom]), body]);
};
