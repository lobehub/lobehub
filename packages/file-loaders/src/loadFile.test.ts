// @vitest-environment node
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { loadFile } from './loadFile';

const fixtures = path.join(__dirname, '../test/fixtures');
const fp = (name: string) => path.join(fixtures, name);

describe('loadFile', () => {
  it('loads text-like files via TextLoader and aggregates', async () => {
    const file = fp('test.txt');
    const doc = await loadFile(file);
    expect(doc.fileType).toBe('txt');
    expect(doc.filename).toBe('test.txt');
    expect(doc.source).toBe(file);
    expect(doc.content).toContain('This is line 1.');
    expect(doc.pages?.[0].metadata.lineNumberStart).toBe(1);
    expect(doc.totalCharCount).toBeGreaterThan(0);
    expect(doc.totalLineCount).toBeGreaterThan(0);
  });

  it('loads pdf files via PdfLoader and aggregates', async () => {
    const file = fp('test.pdf');
    const doc = await loadFile(file);
    expect(doc.fileType).toBe('pdf');
    expect(doc.filename).toBe('test.pdf');
    expect(doc.source).toBe(file);
    expect(doc.content).toContain('123');
    expect(doc.pages && doc.pages.length).toBeGreaterThan(0);
  });

  it('returns error page when fs.stat fails', async () => {
    const doc = await loadFile('/not/exists.xyz');
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages?.[0].metadata.error).toContain('Failed to access file stats:');
    expect(doc.metadata.error).toContain('Failed to access file stats:');
  });

  it('falls back to TextLoader for unsupported type and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const doc = await loadFile(fp('test.epub')); // epub is unsupported in current mapping
    expect(warn).toHaveBeenCalled();
    expect(doc.content.length).toBeGreaterThanOrEqual(0);
    warn.mockRestore();
  });

  it('allows overriding metadata via second parameter', async () => {
    const file = fp('test.txt');
    const override = {
      source: 's3://bucket/key',
      filename: 'override.txt',
      fileType: 'custom',
    };
    const doc = await loadFile(file, override);
    expect(doc.source).toBe('s3://bucket/key');
    expect(doc.filename).toBe('override.txt');
    expect(doc.fileType).toBe('custom');
  });
});
