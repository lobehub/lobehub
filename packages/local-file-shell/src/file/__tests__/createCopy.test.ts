import fs from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { copyLocalFiles, createLocalDirectory, createLocalFile, getCopyName } from '../index';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'local-file-shell-create-copy-'));
});

afterEach(async () => {
  await rm(tmpDir, { force: true, recursive: true });
});

describe('createLocalFile', () => {
  it('creates an empty file by default', async () => {
    const filePath = path.join(tmpDir, 'new.ts');

    const result = await createLocalFile({ path: filePath });

    expect(result).toEqual({ path: filePath, success: true });
    expect(await readFile(filePath, 'utf8')).toBe('');
  });

  it('creates missing parent folders and writes initial content', async () => {
    const filePath = path.join(tmpDir, 'a', 'b', 'c.md');

    const result = await createLocalFile({ content: '# hi', path: filePath });

    expect(result.success).toBe(true);
    expect(await readFile(filePath, 'utf8')).toBe('# hi');
  });

  it('resolves a relative path against cwd', async () => {
    const result = await createLocalFile({ cwd: tmpDir, path: 'rel.txt' });

    expect(result).toEqual({ path: path.join(tmpDir, 'rel.txt'), success: true });
  });

  it('refuses to overwrite an existing file', async () => {
    const filePath = path.join(tmpDir, 'taken.txt');
    await writeFile(filePath, 'keep me');

    const result = await createLocalFile({ content: 'new', path: filePath });

    expect(result.success).toBe(false);
    expect(result.error).toContain('already exists');
    expect(await readFile(filePath, 'utf8')).toBe('keep me');
  });

  it('refuses when a folder already sits at the path', async () => {
    const dirPath = path.join(tmpDir, 'folder');
    await mkdir(dirPath);

    const result = await createLocalFile({ path: dirPath });

    expect(result.success).toBe(false);
    expect(result.error).toContain('already exists');
  });

  it('rejects an empty path', async () => {
    expect(await createLocalFile({ path: '' })).toEqual({
      error: 'Path cannot be empty',
      path: '',
      success: false,
    });
  });
});

describe('createLocalDirectory', () => {
  it('creates a folder', async () => {
    const dirPath = path.join(tmpDir, 'x');

    const result = await createLocalDirectory({ path: dirPath });

    expect(result).toEqual({ path: dirPath, success: true });
    expect(fs.statSync(dirPath).isDirectory()).toBe(true);
  });

  it('does not create missing parent folders', async () => {
    const dirPath = path.join(tmpDir, 'missing', 'child');

    const result = await createLocalDirectory({ path: dirPath });

    expect(result).toEqual({
      error: `The parent folder of ${dirPath} does not exist.`,
      path: dirPath,
      success: false,
    });
    expect(fs.existsSync(path.join(tmpDir, 'missing'))).toBe(false);
  });

  it('refuses when the folder already exists', async () => {
    const dirPath = path.join(tmpDir, 'exists');
    await mkdir(dirPath);
    await writeFile(path.join(dirPath, 'inside.txt'), 'keep');

    const result = await createLocalDirectory({ path: dirPath });

    expect(result.success).toBe(false);
    expect(result.error).toContain('already exists');
    expect(fs.readdirSync(dirPath)).toEqual(['inside.txt']);
  });

  it('refuses when a file already sits at the path', async () => {
    const filePath = path.join(tmpDir, 'file');
    await writeFile(filePath, 'x');

    const result = await createLocalDirectory({ path: filePath });

    expect(result.success).toBe(false);
    expect(result.error).toContain('already exists');
  });
});

describe('getCopyName', () => {
  it.each([
    ['report.pdf', false, 1, 'report copy.pdf'],
    ['report.pdf', false, 2, 'report copy 2.pdf'],
    ['report copy.pdf', false, 2, 'report copy 2.pdf'],
    ['report copy 3.pdf', false, 4, 'report copy 4.pdf'],
    ['.env', false, 1, '.env copy'],
    ['Makefile', false, 1, 'Makefile copy'],
    ['v1.2', true, 1, 'v1.2 copy'],
    ['src', true, 3, 'src copy 3'],
  ])('%s (dir=%s, attempt %i) → %s', (name, isDirectory, attempt, expected) => {
    expect(getCopyName(name, isDirectory, attempt)).toBe(expected);
  });
});

describe('copyLocalFiles', () => {
  it('copies a file to an explicit target', async () => {
    const src = path.join(tmpDir, 'a.txt');
    const dst = path.join(tmpDir, 'sub', 'b.txt');
    await writeFile(src, 'hello');

    const result = await copyLocalFiles({ items: [{ sourcePath: src, targetPath: dst }] });

    expect(result).toEqual([{ sourcePath: src, success: true, targetPath: dst }]);
    expect(await readFile(dst, 'utf8')).toBe('hello');
    expect(await readFile(src, 'utf8')).toBe('hello');
  });

  it('copies a folder recursively and keeps relative symlinks verbatim', async () => {
    const src = path.join(tmpDir, 'pkg');
    await mkdir(path.join(src, 'nested'), { recursive: true });
    await writeFile(path.join(src, 'nested', 'deep.txt'), 'deep');
    await symlink('nested/deep.txt', path.join(src, 'link.txt'));
    const dst = path.join(tmpDir, 'pkg-2');

    const result = await copyLocalFiles({ items: [{ sourcePath: src, targetPath: dst }] });

    expect(result[0].success).toBe(true);
    expect(await readFile(path.join(dst, 'nested', 'deep.txt'), 'utf8')).toBe('deep');
    expect(fs.readlinkSync(path.join(dst, 'link.txt'))).toBe('nested/deep.txt');
  });

  it('refuses to overwrite an existing target file', async () => {
    const src = path.join(tmpDir, 'a.txt');
    const dst = path.join(tmpDir, 'b.txt');
    await writeFile(src, 'incoming');
    await writeFile(dst, 'keep me');

    const [result] = await copyLocalFiles({ items: [{ sourcePath: src, targetPath: dst }] });

    expect(result.success).toBe(false);
    expect(result.error).toContain('already exists');
    expect(await readFile(dst, 'utf8')).toBe('keep me');
  });

  it('refuses to merge a folder into an existing folder', async () => {
    const src = path.join(tmpDir, 'src');
    const dst = path.join(tmpDir, 'dst');
    await mkdir(src);
    await writeFile(path.join(src, 'new.txt'), 'new');
    await mkdir(dst);

    const [result] = await copyLocalFiles({ items: [{ sourcePath: src, targetPath: dst }] });

    expect(result.success).toBe(false);
    expect(result.error).toContain('already exists');
    expect(fs.readdirSync(dst)).toEqual([]);
  });

  it('duplicates next to the source with Finder-style names when targetPath is omitted', async () => {
    const src = path.join(tmpDir, 'notes.md');
    await writeFile(src, 'n');

    const first = await copyLocalFiles({ items: [{ sourcePath: src }] });
    const second = await copyLocalFiles({ items: [{ sourcePath: src }] });
    const ofCopy = await copyLocalFiles({ items: [{ sourcePath: first[0].targetPath! }] });

    expect(first[0].targetPath).toBe(path.join(tmpDir, 'notes copy.md'));
    expect(second[0].targetPath).toBe(path.join(tmpDir, 'notes copy 2.md'));
    expect(ofCopy[0].targetPath).toBe(path.join(tmpDir, 'notes copy 3.md'));
    expect(await readFile(path.join(tmpDir, 'notes copy 2.md'), 'utf8')).toBe('n');
  });

  it('duplicates a folder without splitting a dotted name', async () => {
    const src = path.join(tmpDir, 'v1.2');
    await mkdir(src);
    await writeFile(path.join(src, 'x.txt'), 'x');

    const [result] = await copyLocalFiles({ items: [{ sourcePath: src }] });

    expect(result.targetPath).toBe(path.join(tmpDir, 'v1.2 copy'));
    expect(await readFile(path.join(tmpDir, 'v1.2 copy', 'x.txt'), 'utf8')).toBe('x');
  });

  it('refuses to copy a folder into itself', async () => {
    const src = path.join(tmpDir, 'loop');
    await mkdir(src);

    const [result] = await copyLocalFiles({
      items: [{ sourcePath: src, targetPath: path.join(src, 'inner') }],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('into itself');
  });

  it('reports each item independently', async () => {
    const ok = path.join(tmpDir, 'ok.txt');
    await writeFile(ok, 'ok');
    const missing = path.join(tmpDir, 'missing.txt');

    const result = await copyLocalFiles({
      items: [
        { sourcePath: missing },
        { sourcePath: ok, targetPath: path.join(tmpDir, 'ok2.txt') },
      ],
    });

    expect(result).toEqual([
      { error: `Source path not found: ${missing}.`, sourcePath: missing, success: false },
      { sourcePath: ok, success: true, targetPath: path.join(tmpDir, 'ok2.txt') },
    ]);
  });

  it('returns an empty list for no items', async () => {
    expect(await copyLocalFiles({ items: [] })).toEqual([]);
  });
});
