import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

export const DATASET_PACKAGE_MAX_COMPRESSED_BYTES = 10 * 1024 * 1024;
export const DATASET_PACKAGE_MAX_MANIFEST_BYTES = 25 * 1024 * 1024;
export const DATASET_PACKAGE_MAX_EXPANDED_BYTES = 32 * 1024 * 1024;
export const DATASET_PACKAGE_MAX_ENTRIES = 50;

const END_RECORD = 0x0605_4b50;
const CENTRAL_HEADER = 0x0201_4b50;
const LOCAL_HEADER = 0x0403_4b50;
const DATA_DESCRIPTOR = 0x0807_4b50;
const decoder = new TextDecoder('utf-8', { fatal: true });

interface ArchiveEntry {
  compressedSize: number;
  crc: number;
  flags: number;
  localOffset: number;
  method: number;
  name: string;
  nameBytes: Uint8Array;
  originalSize: number;
}

const invalid = (message: string): never => {
  throw new Error(`Invalid dataset ZIP: ${message}`);
};

const decode = (bytes: Uint8Array, what: string): string => {
  try {
    return decoder.decode(bytes);
  } catch {
    return invalid(`${what} must use valid UTF-8`);
  }
};

const requireRange = (start: number, size: number, end: number) => {
  if (start < 0 || size < 0 || start > end || size > end - start) {
    invalid('truncated or overlapping archive records');
  }
};

const validateName = (name: string) => {
  // eslint-disable-next-line no-control-regex -- ZIP entry paths must reject control characters.
  if (!name || name.startsWith('/') || name.includes('\\') || /[\u0000-\u001F\u007F:]/.test(name)) {
    invalid('unsafe entry path');
  }
  const segments = (name.endsWith('/') ? name.slice(0, -1) : name).split('/');
  if (segments.some((part) => !part || part === '.' || part === '..')) {
    invalid('unsafe entry path');
  }
  const leaf = segments.at(-1)!;
  const isMacMetadata = leaf === '.DS_Store' || leaf.startsWith('._');
  if (name !== 'dataset.json' && name !== 'README.md' && !name.endsWith('/') && !isMacMetadata) {
    invalid('only dataset.json, README.md, directories and macOS metadata are supported');
  }
};

const validateExtra = (view: DataView, start: number, size: number) => {
  const end = start + size;
  while (start < end) {
    requireRange(start, 4, end);
    const id = view.getUint16(start, true);
    const length = view.getUint16(start + 2, true);
    if (id === 0x0001) invalid('ZIP64 archives are not supported');
    requireRange(start + 4, length, end);
    start += 4 + length;
  }
};

const readDirectory = (bytes: Uint8Array, view: DataView) => {
  let endOffset = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset--) {
    if (
      view.getUint32(offset, true) === END_RECORD &&
      offset + 22 + view.getUint16(offset + 20, true) === bytes.length
    ) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) invalid('missing or truncated end record');
  const count = view.getUint16(endOffset + 10, true);
  if (
    view.getUint16(endOffset + 4, true) !== 0 ||
    view.getUint16(endOffset + 6, true) !== 0 ||
    view.getUint16(endOffset + 8, true) !== count
  ) {
    invalid('multi-volume archives are not supported');
  }
  if (count === 0xffff) invalid('ZIP64 archives are not supported');
  if (count === 0 || count > DATASET_PACKAGE_MAX_ENTRIES) {
    invalid(`the archive must contain between 1 and ${DATASET_PACKAGE_MAX_ENTRIES} entries`);
  }
  const directorySize = view.getUint32(endOffset + 12, true);
  const directoryOffset = view.getUint32(endOffset + 16, true);
  requireRange(directoryOffset, directorySize, endOffset);
  if (directoryOffset + directorySize !== endOffset) invalid('invalid central directory boundary');

  const entries: ArchiveEntry[] = [];
  const names = new Set<string>();
  let offset = directoryOffset;
  let totalSize = 0;
  for (let index = 0; index < count; index++) {
    requireRange(offset, 46, endOffset);
    if (view.getUint32(offset, true) !== CENTRAL_HEADER) invalid('invalid central directory');
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const originalSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    requireRange(offset + 46, nameLength + extraLength + commentLength, endOffset);
    if (flags & 0x0041) invalid('encrypted archives are not supported');
    if (flags & ~0x080e) invalid('unsupported ZIP flags');
    if (method !== 0 && method !== 8) invalid('only stored or DEFLATE entries are supported');
    if (view.getUint16(offset + 34, true) !== 0) invalid('multi-volume entries are not supported');
    if ([compressedSize, originalSize, localOffset].includes(0xffff_ffff)) {
      invalid('ZIP64 entries are not supported');
    }
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
    if (!(flags & 0x0800) && nameBytes.some((value) => value > 0x7f)) {
      invalid('non-ASCII entry names must use the UTF-8 flag');
    }
    const name = decode(nameBytes, 'entry names');
    validateName(name);
    if (names.has(name)) invalid('duplicate entry names');
    names.add(name);
    const fileType = (view.getUint32(offset + 38, true) >>> 16) & 0xf000;
    if (fileType !== 0 && fileType !== 0x8000 && fileType !== 0x4000) {
      invalid('symlinks and special files are not supported');
    }
    if ((fileType === 0x4000 || name.endsWith('/')) && originalSize !== 0) {
      invalid('directory entries must be empty');
    }
    if (name === 'dataset.json' && originalSize > DATASET_PACKAGE_MAX_MANIFEST_BYTES) {
      invalid('dataset.json exceeds the 25 MiB limit');
    }
    totalSize += originalSize;
    if (totalSize > DATASET_PACKAGE_MAX_EXPANDED_BYTES)
      invalid('expanded data exceeds the 32 MiB limit');
    validateExtra(view, offset + 46 + nameLength, extraLength);
    entries.push({
      compressedSize,
      crc: view.getUint32(offset + 16, true),
      flags,
      localOffset,
      method,
      name,
      nameBytes,
      originalSize,
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset !== endOffset) invalid('central directory entry count does not match');
  if (!names.has('dataset.json')) invalid('dataset.json must be at the archive root');
  return { directoryOffset, entries: entries.sort((a, b) => a.localOffset - b.localOffset) };
};

const readPayload = (
  bytes: Uint8Array,
  view: DataView,
  entry: ArchiveEntry,
  directoryOffset: number,
): { compressed: Uint8Array; end: number } => {
  const offset = entry.localOffset;
  requireRange(offset, 30, directoryOffset);
  if (view.getUint32(offset, true) !== LOCAL_HEADER) invalid('invalid local file header');
  if (
    view.getUint16(offset + 6, true) !== entry.flags ||
    view.getUint16(offset + 8, true) !== entry.method
  ) {
    invalid('local and central file headers disagree');
  }
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  requireRange(offset + 30, nameLength + extraLength, directoryOffset);
  const localName = bytes.subarray(offset + 30, offset + 30 + nameLength);
  if (
    localName.length !== entry.nameBytes.length ||
    localName.some((value, i) => value !== entry.nameBytes[i])
  ) {
    invalid('local and central entry names disagree');
  }
  validateExtra(view, offset + 30 + nameLength, extraLength);
  const start = offset + 30 + nameLength + extraLength;
  requireRange(start, entry.compressedSize, directoryOffset);
  let end = start + entry.compressedSize;
  const expected = [entry.crc, entry.compressedSize, entry.originalSize];
  for (let i = 0; i < expected.length; i++) {
    const actual = view.getUint32(offset + 14 + i * 4, true);
    if (actual !== expected[i] && (!(entry.flags & 8) || actual !== 0)) {
      invalid('local and central entry sizes or checksum disagree');
    }
  }
  if (entry.flags & 8) {
    requireRange(end, 12, directoryOffset);
    // The signature is optional, and a signature-free CRC can itself equal it.
    const hasSignature =
      end + 16 <= directoryOffset &&
      view.getUint32(end, true) === DATA_DESCRIPTOR &&
      expected.every((value, i) => view.getUint32(end + 4 + i * 4, true) === value);
    if (hasSignature) end += 4;
    if (expected.some((value, i) => view.getUint32(end + i * 4, true) !== value)) {
      invalid('invalid data descriptor');
    }
    end += 12;
  }
  return { compressed: bytes.subarray(start, start + entry.compressedSize), end };
};

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
  return crc >>> 0;
});

const checksum = (bytes: Uint8Array) => {
  let crc = 0xffff_ffff;
  for (const value of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ value) & 0xff];
  return (crc ^ 0xffff_ffff) >>> 0;
};

/**
 * Read an in-memory package, without extracting paths or executing any archive content.
 * The only data file is a root dataset.json. README.md, empty directories and macOS
 * metadata are tolerated, but still validated and included in the resource budgets.
 * The returned hash covers the exact manifest bytes, independent of ZIP timestamps.
 */
export const readDatasetPackageArchive = (
  data: Uint8Array,
): { manifest: unknown; sha256: string } => {
  if (data.byteLength > DATASET_PACKAGE_MAX_COMPRESSED_BYTES) {
    invalid('compressed data exceeds the 10 MiB limit');
  }
  if (data.byteLength < 22) invalid('missing or truncated end record');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const { directoryOffset, entries } = readDirectory(data, view);
  let cursor = 0;
  let expandedSize = 0;
  let manifestBytes: Uint8Array | undefined;
  for (const entry of entries) {
    if (entry.localOffset !== cursor) invalid('unlisted, overlapping or prefixed archive data');
    const { compressed, end } = readPayload(data, view, entry, directoryOffset);
    cursor = end;
    const maximum = Math.min(
      entry.name === 'dataset.json'
        ? DATASET_PACKAGE_MAX_MANIFEST_BYTES
        : DATASET_PACKAGE_MAX_EXPANDED_BYTES,
      DATASET_PACKAGE_MAX_EXPANDED_BYTES - expandedSize,
      entry.originalSize,
    );
    let output: Uint8Array;
    if (entry.method === 0) {
      output = compressed;
    } else {
      try {
        // The native decoder enforces this bound while inflating, including when
        // the archive lies about its uncompressed size. Do not use unbounded unzip.
        const result = inflateRawSync(compressed, {
          info: true,
          maxOutputLength: Math.max(1, maximum),
        }) as unknown as { buffer: Uint8Array; engine: { bytesWritten: number } };
        if (result.engine.bytesWritten !== compressed.byteLength)
          invalid('trailing compressed data');
        output = result.buffer;
      } catch {
        return invalid('invalid DEFLATE data or expanded size exceeds the limit');
      }
    }
    if (output.byteLength > maximum || output.byteLength !== entry.originalSize) {
      invalid('actual expanded size does not match the archive');
    }
    if (checksum(output) !== entry.crc) invalid('entry checksum does not match');
    expandedSize += output.byteLength;
    if (entry.name === 'dataset.json') manifestBytes = output;
  }
  if (cursor !== directoryOffset) invalid('unlisted archive data before the central directory');
  if (!manifestBytes) return invalid('dataset.json must be at the archive root');
  let manifest: unknown;
  try {
    manifest = JSON.parse(decode(manifestBytes, 'dataset.json'));
  } catch {
    return invalid('dataset.json must contain valid UTF-8 JSON');
  }
  return { manifest, sha256: createHash('sha256').update(manifestBytes).digest('hex') };
};
