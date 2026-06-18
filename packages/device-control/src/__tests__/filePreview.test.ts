import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { defaultGetLocalFilePreview } from '../filePreview';

let root: string;
let outside: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'dc-preview-'));
  outside = await mkdtemp(path.join(tmpdir(), 'dc-outside-'));
  await writeFile(path.join(root, 'note.txt'), 'hello preview\n');
  await writeFile(path.join(root, 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  await writeFile(path.join(outside, 'secret.txt'), 'do not read\n');
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
