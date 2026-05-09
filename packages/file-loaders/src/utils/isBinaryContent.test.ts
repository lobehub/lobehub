import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sniffBinaryBuffer, sniffBinaryFile } from './isBinaryContent';

describe('sniffBinaryBuffer', () => {
  it('treats empty buffer as text', () => {
    expect(sniffBinaryBuffer(Buffer.alloc(0))).toEqual({ isBinary: false });
  });

  it('treats plain ASCII text as text', () => {
    const buf = Buffer.from('hello world\nthis is text\n', 'utf8');
    expect(sniffBinaryBuffer(buf).isBinary).toBe(false);
  });

  it('treats UTF-8 with CJK as text', () => {
    const buf = Buffer.from('你好,世界。这是中文。\n这也是中文。', 'utf8');
    expect(sniffBinaryBuffer(buf).isBinary).toBe(false);
  });

  it('treats base64 text as text (no null bytes, all printable)', () => {
    const longBase64 = Buffer.from('A'.repeat(2000) + 'B'.repeat(2000) + '+/=', 'utf8');
    expect(sniffBinaryBuffer(longBase64).isBinary).toBe(false);
  });

  it('flags buffers containing a null byte as binary', () => {
    const buf = Buffer.concat([Buffer.from('hello'), Buffer.from([0x00]), Buffer.from('world')]);
    const result = sniffBinaryBuffer(buf);
    expect(result.isBinary).toBe(true);
    expect(result.reason).toContain('null byte');
  });

  it('respects UTF-8 BOM and treats as text', () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('hello')]);
    expect(sniffBinaryBuffer(buf).isBinary).toBe(false);
  });

  it('respects UTF-16LE BOM and treats as text even with embedded zero bytes', () => {
    const buf = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from([0x68, 0x00, 0x69, 0x00]), // "hi" in UTF-16LE
    ]);
    expect(sniffBinaryBuffer(buf).isBinary).toBe(false);
  });

  it('flags buffers with high non-printable ratio', () => {
    const bytes: number[] = [];
    for (let i = 0; i < 100; i++) bytes.push(i % 0x20 === 0 ? 0x41 : 0x01);
    const buf = Buffer.from(bytes);
    const result = sniffBinaryBuffer(buf);
    expect(result.isBinary).toBe(true);
  });
});

describe('sniffBinaryFile', () => {
  const tmpDir = path.join(os.tmpdir(), 'sniff-binary-test-' + process.pid);

  beforeEach(async () => {
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  it('reads only the first 8KB and reports text for plain ASCII', async () => {
    const filePath = path.join(tmpDir, 'plain.txt');
    await writeFile(filePath, 'a'.repeat(20_000));
    const result = await sniffBinaryFile(filePath);
    expect(result.isBinary).toBe(false);
  });

  it('flags a file whose first bytes contain null', async () => {
    const filePath = path.join(tmpDir, 'binary.bin');
    await writeFile(filePath, Buffer.from([0x48, 0x00, 0x65, 0x6c, 0x6c, 0x6f]));
    const result = await sniffBinaryFile(filePath);
    expect(result.isBinary).toBe(true);
  });
});
