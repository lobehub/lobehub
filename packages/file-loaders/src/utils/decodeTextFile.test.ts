import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  decodeTextBuffer,
  decodeTextFile,
  detectTextFileFormat,
  encodeTextBuffer,
} from './decodeTextFile';

describe('decodeTextBuffer', () => {
  it('decodes UTF-16LE with BOM and reports the BOM', () => {
    const buffer = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('héllo\nworld', 'utf16le'),
    ]);

    const result = decodeTextBuffer(buffer);

    expect(result).toEqual({
      bom: 'utf-16le',
      content: 'héllo\nworld',
      encoding: 'utf-16le',
    });
  });

  it('decodes UTF-16BE with BOM and reports the BOM', () => {
    // Swap only the payload's byte pairs; the BOM is already BE-ordered.
    const payload = Buffer.from('héllo', 'utf16le').swap16();
    const buffer = Buffer.concat([Buffer.from([0xfe, 0xff]), payload]);

    const result = decodeTextBuffer(buffer);

    expect(result).toEqual({ bom: 'utf-16be', content: 'héllo', encoding: 'utf-16be' });
  });

  it('strips a UTF-8 BOM and reports it without changing the encoding', () => {
    const buffer = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('plain text\n')]);

    const result = decodeTextBuffer(buffer);

    expect(result).toEqual({ bom: 'utf8', content: 'plain text\n', encoding: 'utf8' });
  });

  it('detects BOM-less UTF-16LE via the shared heuristic', () => {
    const buffer = Buffer.from('ascii content without any marker\n', 'utf16le');

    const result = decodeTextBuffer(buffer);

    expect(result).toEqual({
      bom: null,
      content: 'ascii content without any marker\n',
      encoding: 'utf-16le',
    });
  });

  it('falls back to UTF-8 for plain ASCII bytes', () => {
    expect(decodeTextBuffer(Buffer.from('hello\nworld\n'))).toEqual({
      bom: null,
      content: 'hello\nworld\n',
      encoding: 'utf8',
    });
  });

  it('handles an empty buffer', () => {
    expect(decodeTextBuffer(Buffer.alloc(0))).toEqual({
      bom: null,
      content: '',
      encoding: 'utf8',
    });
  });
});

describe('encodeTextBuffer', () => {
  it('round-trips UTF-16LE with BOM', () => {
    const original = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('héllo\nwörld', 'utf16le'),
    ]);

    const decoded = decodeTextBuffer(original);
    const encoded = encodeTextBuffer(decoded.content, decoded.encoding, decoded.bom);

    expect(encoded.equals(original)).toBe(true);
  });

  it('round-trips UTF-16BE with BOM including surrogate pairs', () => {
    const text = 'héllo 👍 wörld';
    const payload = Buffer.from(text, 'utf16le').swap16();
    const original = Buffer.concat([Buffer.from([0xfe, 0xff]), payload]);

    const decoded = decodeTextBuffer(original);
    const encoded = encodeTextBuffer(decoded.content, decoded.encoding, decoded.bom);

    expect(encoded.equals(original)).toBe(true);
  });

  it('round-trips UTF-8 with BOM', () => {
    const original = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('héllo\n')]);

    const decoded = decodeTextBuffer(original);
    const encoded = encodeTextBuffer(decoded.content, decoded.encoding, decoded.bom);

    expect(encoded.equals(original)).toBe(true);
  });

  it('round-trips BOM-less UTF-16LE', () => {
    const original = Buffer.from('no marker here\n', 'utf16le');

    const decoded = decodeTextBuffer(original);
    const encoded = encodeTextBuffer(decoded.content, decoded.encoding, decoded.bom);

    expect(encoded.equals(original)).toBe(true);
  });

  it('round-trips plain UTF-8', () => {
    const original = Buffer.from('plain utf8\n');

    const decoded = decodeTextBuffer(original);
    const encoded = encodeTextBuffer(decoded.content, decoded.encoding, decoded.bom);

    expect(encoded.equals(original)).toBe(true);
  });
});

describe('decodeTextFile / detectTextFileFormat', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `decode-text-file-test-${process.pid}-${Date.now()}`);
    require('node:fs').mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    require('node:fs').rmSync(tmpDir, { force: true, recursive: true });
  });

  it('decodes a PowerShell-style UTF-16LE CRLF file from disk', async () => {
    const filePath = path.join(tmpDir, 'utf16.txt');
    await writeFile(
      filePath,
      Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from('line one\r\n  indented line\r\n', 'utf16le'),
      ]),
    );

    const result = await decodeTextFile(filePath);

    expect(result.content).toBe('line one\r\n  indented line\r\n');
    expect(result.encoding).toBe('utf-16le');
    expect(result.bom).toBe('utf-16le');
  });

  it('detects the format of a UTF-16 file without reading it all', async () => {
    const filePath = path.join(tmpDir, 'utf16-big.txt');
    await writeFile(
      filePath,
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('marker\n', 'utf16le')]),
    );

    const format = await detectTextFileFormat(filePath);

    expect(format).toEqual({ bom: 'utf-16le', encoding: 'utf-16le' });
  });

  it('reports utf8 for a plain file', async () => {
    const filePath = path.join(tmpDir, 'plain.txt');
    await writeFile(filePath, 'plain\n');

    expect(await detectTextFileFormat(filePath)).toEqual({ bom: null, encoding: 'utf8' });
  });
});
