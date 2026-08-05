import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { defaultGetLocalFilePreview } from '../filePreview';

const mockedHome = vi.hoisted(() => ({ dir: '' }));

vi.mock('node:os', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, default: actual, homedir: () => mockedHome.dir };
});

let root: string;
let outside: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'dc-preview-'));
  outside = await mkdtemp(path.join(tmpdir(), 'dc-outside-'));
  mockedHome.dir = root;
  await writeFile(path.join(root, 'note.txt'), 'hello preview\n');
  await writeFile(path.join(root, 'win.txt'), 'hello windows\n');
  // Full PNG signature + IHDR chunk header so file-type recognises the format.
  await writeFile(
    path.join(root, 'pic.png'),
    Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52,
    ]),
  );
  await writeFile(path.join(outside, 'secret.txt'), 'do not read\n');
  // `%PDF` magic bytes so file-type recognises the format.
  await writeFile(path.join(root, 'doc.pdf'), Buffer.from('%PDF-1.4\n%fake'));
  // No magic bytes on purpose: a binary buffer + `.docx` extension resolves the
  // OOXML mime through the extension fallback.
  await writeFile(
    path.join(root, 'report.docx'),
    Buffer.concat([Buffer.from([0x05, 0x00, 0x03]), Buffer.from('fake-docx')]),
  );
});

afterAll(async () => {
  await Promise.all([root, outside].map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('defaultGetLocalFilePreview', () => {
  it('reads a text file inside the working directory', async () => {
    const result = await defaultGetLocalFilePreview({
      path: path.join(root, 'note.txt'),
      workingDirectory: root,
    });
    expect(result.success).toBe(true);
    expect(result.preview).toMatchObject({ content: 'hello preview\n', type: 'text' });
  });

  it('expands ~ paths against the home directory', async () => {
    const result = await defaultGetLocalFilePreview({
      path: '~/note.txt',
      workingDirectory: root,
    });
    expect(result.success).toBe(true);
    expect(result.preview).toMatchObject({ content: 'hello preview\n', type: 'text' });
  });

  it('falls back to a content-less document preview without reading oversized files', async () => {
    const bigPdf = path.join(root, 'big.pdf');
    // 20 MB + 1 byte of zeros: over the document cap, extension-detectable.
    await writeFile(bigPdf, Buffer.alloc(20 * 1024 * 1024 + 1));

    const result = await defaultGetLocalFilePreview({
      path: bigPdf,
      workingDirectory: root,
    });
    expect(result.success).toBe(true);
    expect(result.preview).toEqual({ contentType: 'application/pdf', type: 'pdf' });
  });

  it('expands backslash home paths without leaving a literal separator', async () => {
    const result = await defaultGetLocalFilePreview({
      path: '~\\win.txt',
      workingDirectory: root,
    });
    expect(result.success).toBe(true);
    expect(result.preview).toMatchObject({ content: 'hello windows\n', type: 'text' });
  });

  it('reads an image file as base64', async () => {
    const result = await defaultGetLocalFilePreview({
      path: path.join(root, 'pic.png'),
      workingDirectory: root,
    });
    expect(result.success).toBe(true);
    expect(result.preview?.type).toBe('image');
    expect((result.preview as { base64: string }).base64).toBeTruthy();
    expect((result.preview as { contentType: string }).contentType).toBe('image/png');
  });

  it('reads a pdf as a base64 document preview', async () => {
    const result = await defaultGetLocalFilePreview({
      path: path.join(root, 'doc.pdf'),
      workingDirectory: root,
    });
    expect(result.success).toBe(true);
    expect(result.preview).toMatchObject({ contentType: 'application/pdf', type: 'document' });
    expect((result.preview as { base64: string }).base64).toBeTruthy();
  });

  it('reads an office file as a base64 document preview', async () => {
    const result = await defaultGetLocalFilePreview({
      path: path.join(root, 'report.docx'),
      workingDirectory: root,
    });
    expect(result.success).toBe(true);
    expect(result.preview).toMatchObject({
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      type: 'document',
    });
    expect((result.preview as { base64: string }).base64).toBeTruthy();
  });

  it('rejects a non-image when accept is "image"', async () => {
    const result = await defaultGetLocalFilePreview({
      accept: 'image',
      path: path.join(root, 'note.txt'),
      workingDirectory: root,
    });
    expect(result).toEqual({ error: 'File is not an image', success: false });
  });

  it('refuses to read a file outside the working directory', async () => {
    const result = await defaultGetLocalFilePreview({
      path: path.join(outside, 'secret.txt'),
      workingDirectory: root,
    });
    expect(result).toEqual({ error: 'File is outside the approved workspace', success: false });
  });

  it('errors when the working directory is missing', async () => {
    const result = await defaultGetLocalFilePreview({
      path: path.join(root, 'note.txt'),
      workingDirectory: '',
    });
    expect(result).toEqual({ error: 'Missing working directory', success: false });
  });

  it('fails gracefully for a non-existent file', async () => {
    const result = await defaultGetLocalFilePreview({
      path: path.join(root, 'ghost.txt'),
      workingDirectory: root,
    });
    expect(result.success).toBe(false);
  });
});
