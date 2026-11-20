import { createHash } from 'node:crypto';

import { strToU8, Zip, ZipDeflate, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import {
  DATASET_PACKAGE_MAX_COMPRESSED_BYTES,
  DATASET_PACKAGE_MAX_ENTRIES,
  DATASET_PACKAGE_MAX_EXPANDED_BYTES,
  DATASET_PACKAGE_MAX_MANIFEST_BYTES,
  readDatasetPackageArchive,
} from './archive';

const manifest = { cases: [], name: 'Synthetic import test', version: 1 };
const manifestBytes = strToU8(JSON.stringify(manifest));
const archive = () => zipSync({ 'dataset.json': manifestBytes });
const viewOf = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

// Helpers only inspect well-formed synthetic archives before corrupting one field.
const directoryEntries = (bytes: Uint8Array) => {
  const view = viewOf(bytes);
  const end = bytes.length - 22;
  let offset = view.getUint32(end + 16, true);
  return Array.from({ length: view.getUint16(end + 10, true) }, () => {
    const current = offset;
    offset +=
      46 +
      view.getUint16(offset + 28, true) +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true);
    return current;
  });
};

const replaceExpandedSize = (bytes: Uint8Array, index: number, size: number) => {
  const view = viewOf(bytes);
  const central = directoryEntries(bytes)[index];
  const local = view.getUint32(central + 42, true);
  view.setUint32(central + 24, size, true);
  view.setUint32(local + 22, size, true);
};

const streamingArchive = () => {
  const chunks: Uint8Array[] = [];
  const zip = new Zip((error, chunk) => {
    if (error) throw error;
    chunks.push(chunk);
  });
  const file = new ZipDeflate('dataset.json');
  zip.add(file);
  file.push(manifestBytes.subarray(0, 10));
  file.push(manifestBytes.subarray(10), true);
  zip.end();
  return new Uint8Array(Buffer.concat(chunks));
};

describe('readDatasetPackageArchive', () => {
  it.each([0, 6] as const)('reads a root manifest with compression level %s', (level) => {
    const result = readDatasetPackageArchive(zipSync({ 'dataset.json': manifestBytes }, { level }));

    expect(result).toEqual({
      manifest,
      sha256: createHash('sha256').update(manifestBytes).digest('hex'),
    });
  });

  it('uses manifest bytes for identity, independent of ZIP timestamp and README', () => {
    const first = zipSync({ 'dataset.json': manifestBytes }, { mtime: new Date('2020-01-01') });
    const second = zipSync(
      { 'README.md': strToU8('Package instructions'), 'dataset.json': manifestBytes },
      { mtime: new Date('2024-01-01') },
    );

    expect(readDatasetPackageArchive(first).sha256).toBe(readDatasetPackageArchive(second).sha256);
  });

  it('accepts harmless macOS metadata and standard extended timestamps', () => {
    const bytes = zipSync({
      '.DS_Store': strToU8('synthetic metadata'),
      'README.md': strToU8('No private cases included'),
      '__MACOSX/': new Uint8Array(),
      '__MACOSX/._dataset.json': strToU8('synthetic AppleDouble metadata'),
      'dataset.json': [manifestBytes, { extra: { 0x5455: new Uint8Array(5) }, os: 19 }],
    });

    expect(readDatasetPackageArchive(bytes).manifest).toEqual(manifest);
  });

  it('handles a Uint8Array view with a nonzero buffer offset', () => {
    const bytes = archive();
    const buffer = new Uint8Array(bytes.length + 12);
    buffer.set(bytes, 7);

    expect(readDatasetPackageArchive(buffer.subarray(7, 7 + bytes.length)).manifest).toEqual(
      manifest,
    );
  });

  it('accepts ZIP data descriptors emitted by streaming encoders', () => {
    const bytes = streamingArchive();
    expect(viewOf(bytes).getUint16(6, true) & 8).toBe(8);

    expect(readDatasetPackageArchive(bytes).manifest).toEqual(manifest);
  });

  it('accepts data descriptors without the optional signature', () => {
    const bytes = streamingArchive();
    const view = viewOf(bytes);
    const central = directoryEntries(bytes)[0];
    const descriptor =
      30 + view.getUint16(26, true) + view.getUint16(28, true) + view.getUint32(central + 20, true);
    const unsigned = new Uint8Array(bytes.length - 4);
    unsigned.set(bytes.subarray(0, descriptor));
    unsigned.set(bytes.subarray(descriptor + 4), descriptor);
    viewOf(unsigned).setUint32(unsigned.length - 6, central - 4, true);

    expect(readDatasetPackageArchive(unsigned).manifest).toEqual(manifest);
  });

  it('rejects a corrupted data descriptor', () => {
    const bytes = streamingArchive();
    const central = directoryEntries(bytes)[0];
    bytes[central - 12] ^= 1;

    expect(() => readDatasetPackageArchive(bytes)).toThrow('invalid data descriptor');
  });

  it.each([0, 5, 22])('rejects missing or truncated ZIP data (%s bytes)', (length) => {
    expect(() => readDatasetPackageArchive(new Uint8Array(length))).toThrow('end record');
  });

  it('rejects a ZIP truncated at its end', () => {
    expect(() => readDatasetPackageArchive(archive().subarray(0, -1))).toThrow('end record');
  });

  it('rejects unexpected bytes after the archive', () => {
    const bytes = new Uint8Array([...archive(), 1, 2, 3]);
    expect(() => readDatasetPackageArchive(bytes)).toThrow('end record');
  });

  it('requires dataset.json at the archive root', () => {
    expect(() =>
      readDatasetPackageArchive(zipSync({ 'README.md': strToU8('Instructions') })),
    ).toThrow('dataset.json must be at the archive root');
    expect(() =>
      readDatasetPackageArchive(zipSync({ 'package/dataset.json': manifestBytes })),
    ).toThrow('only dataset.json');
  });

  it.each([
    '../.DS_Store',
    '/dataset.json',
    'folder\\dataset.json',
    'C:/dataset.json',
    './dataset.json',
    'x//._file',
  ])('rejects unsafe paths, including metadata: %s', (name) => {
    expect(() =>
      readDatasetPackageArchive(
        zipSync({ [name]: new Uint8Array(), 'dataset.json': manifestBytes }),
      ),
    ).toThrow('unsafe entry path');
  });

  it.each(['cases.json', 'setup.js', 'other.txt'])(
    'rejects unsupported data instead of ignoring %s',
    (name) => {
      expect(() =>
        readDatasetPackageArchive(
          zipSync({ [name]: strToU8('data'), 'dataset.json': manifestBytes }),
        ),
      ).toThrow('only dataset.json');
    },
  );

  it('rejects duplicate dataset.json entries', () => {
    const bytes = zipSync({ 'dataset.json': manifestBytes, 'payload.json': manifestBytes });
    const view = viewOf(bytes);
    const central = directoryEntries(bytes)[1];
    const local = view.getUint32(central + 42, true);
    bytes.set(strToU8('dataset.json'), central + 46);
    bytes.set(strToU8('dataset.json'), local + 30);

    expect(() => readDatasetPackageArchive(bytes)).toThrow('duplicate entry names');
  });

  it('rejects encrypted ZIP entries before processing the payload', () => {
    const bytes = archive();
    const view = viewOf(bytes);
    view.setUint16(directoryEntries(bytes)[0] + 8, 1, true);
    view.setUint16(6, 1, true);

    expect(() => readDatasetPackageArchive(bytes)).toThrow('encrypted archives');
  });

  it('rejects symlinks masquerading as a manifest', () => {
    const bytes = zipSync({ 'dataset.json': [manifestBytes, { attrs: 0xa1ff_0000, os: 3 }] });
    expect(() => readDatasetPackageArchive(bytes)).toThrow('symlinks and special files');
  });

  it('rejects nonempty directory entries', () => {
    const bytes = zipSync({ 'dataset.json': manifestBytes, 'folder/': strToU8('hidden data') });
    expect(() => readDatasetPackageArchive(bytes)).toThrow('directory entries must be empty');
  });

  it('checks stored file integrity even when the modified payload is still JSON', () => {
    const bytes = zipSync({ 'dataset.json': strToU8('{"version":1}') }, { level: 0 });
    const view = viewOf(bytes);
    const start = 30 + view.getUint16(26, true) + view.getUint16(28, true);
    bytes[start + 11] = '2'.charCodeAt(0);

    expect(() => readDatasetPackageArchive(bytes)).toThrow('entry checksum does not match');
  });

  it('rejects conflicting local and central filenames', () => {
    const bytes = archive();
    bytes[30] = 'D'.charCodeAt(0);
    expect(() => readDatasetPackageArchive(bytes)).toThrow('entry names disagree');
  });

  it('rejects conflicting local and central sizes', () => {
    const bytes = archive();
    viewOf(bytes).setUint32(22, 1, true);
    expect(() => readDatasetPackageArchive(bytes)).toThrow('sizes or checksum disagree');
  });

  it.each([-1, 1])('rejects a DEFLATE stream with %s bytes even if ZIP sizes agree', (delta) => {
    const original = archive();
    const central = directoryEntries(original)[0];
    const compressedSize = viewOf(original).getUint32(central + 20, true);
    const bytes = new Uint8Array(original.length + delta);
    bytes.set(original.subarray(0, delta < 0 ? central - 1 : central));
    bytes.set(original.subarray(central), central + delta);
    const view = viewOf(bytes);
    view.setUint32(18, compressedSize + delta, true);
    view.setUint32(central + delta + 20, compressedSize + delta, true);
    view.setUint32(bytes.length - 6, central + delta, true);

    expect(() => readDatasetPackageArchive(bytes)).toThrow('invalid DEFLATE data');
  });

  it('rejects directory offsets pointing outside the ZIP file', () => {
    const bytes = archive();
    viewOf(bytes).setUint32(bytes.length - 6, bytes.length + 1, true);
    expect(() => readDatasetPackageArchive(bytes)).toThrow('truncated or overlapping');
  });

  it('rejects central directory entries that overlap earlier file data', () => {
    const bytes = zipSync({ 'dataset.json': manifestBytes, 'README.md': strToU8('Instructions') });
    viewOf(bytes).setUint32(directoryEntries(bytes)[1] + 42, 0, true);
    expect(() => readDatasetPackageArchive(bytes)).toThrow('overlapping');
  });

  it('rejects compressed archives over 10 MiB', () => {
    expect(() =>
      readDatasetPackageArchive(new Uint8Array(DATASET_PACKAGE_MAX_COMPRESSED_BYTES + 1)),
    ).toThrow('10 MiB limit');
  });

  it('rejects manifest sizes over 25 MiB before inflation', () => {
    const bytes = archive();
    replaceExpandedSize(bytes, 0, DATASET_PACKAGE_MAX_MANIFEST_BYTES + 1);
    expect(() => readDatasetPackageArchive(bytes)).toThrow('25 MiB limit');
  });

  it('enforces the aggregate expanded budget including ignored metadata', () => {
    const bytes = zipSync({ 'dataset.json': manifestBytes, '.DS_Store': strToU8('metadata') });
    replaceExpandedSize(bytes, 1, DATASET_PACKAGE_MAX_EXPANDED_BYTES);
    expect(() => readDatasetPackageArchive(bytes)).toThrow('32 MiB limit');
  });

  it('bounds the actual decoder output when a compressed bomb lies about its size', () => {
    const bytes = zipSync({
      'dataset.json': new Uint8Array(DATASET_PACKAGE_MAX_MANIFEST_BYTES + 1),
    });
    replaceExpandedSize(bytes, 0, 1024);
    expect(bytes.length).toBeLessThan(DATASET_PACKAGE_MAX_COMPRESSED_BYTES);
    expect(() => readDatasetPackageArchive(bytes)).toThrow('expanded size exceeds the limit');
  });

  it('rejects excess entries, including directories and metadata', () => {
    const files: Record<string, Uint8Array> = { 'dataset.json': manifestBytes };
    for (let index = 0; index < DATASET_PACKAGE_MAX_ENTRIES; index++) {
      files[`__MACOSX/._${index}`] = new Uint8Array();
    }
    expect(() => readDatasetPackageArchive(zipSync(files))).toThrow('between 1 and 50 entries');
  });

  it('rejects ZIP64 metadata', () => {
    const bytes = zipSync({
      'dataset.json': [manifestBytes, { extra: { 1: new Uint8Array(16) } }],
    });
    expect(() => readDatasetPackageArchive(bytes)).toThrow('ZIP64');
  });

  it('rejects split archives', () => {
    const bytes = archive();
    viewOf(bytes).setUint16(bytes.length - 18, 1, true);
    expect(() => readDatasetPackageArchive(bytes)).toThrow('multi-volume');
  });

  it('rejects a manifest that is not JSON', () => {
    const bytes = zipSync({ 'dataset.json': strToU8('this is not JSON') });
    expect(() => readDatasetPackageArchive(bytes)).toThrow('valid UTF-8 JSON');
  });

  it('rejects malformed UTF-8 instead of replacing bytes inside the manifest', () => {
    const bytes = zipSync({ 'dataset.json': new Uint8Array([0x22, 0xff, 0x22]) });
    expect(() => readDatasetPackageArchive(bytes)).toThrow('valid UTF-8 JSON');
  });
});
