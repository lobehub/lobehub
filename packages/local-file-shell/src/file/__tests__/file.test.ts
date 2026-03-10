import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  editLocalFile,
  globLocalFiles,
  grepContent,
  listLocalFiles,
  moveLocalFiles,
  readLocalFile,
  renameLocalFile,
  searchLocalFiles,
  writeLocalFile,
} from '../index';

describe('file operations', () => {
  const tmpDir = path.join(os.tmpdir(), 'local-file-shell-test-' + process.pid);

  beforeEach(async () => {
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  // ─── readLocalFile ───

  describe('readLocalFile', () => {
    it('should read file with default line range (0-200)', async () => {
      const filePath = path.join(tmpDir, 'test.txt');
      const lines = Array.from({ length: 300 }, (_, i) => `line ${i}`);
      await writeFile(filePath, lines.join('\n'));

      const result = await readLocalFile({ path: filePath });

      expect(result.lineCount).toBe(200);
      expect(result.totalLineCount).toBe(300);
      expect(result.loc).toEqual([0, 200]);
      expect(result.filename).toBe('test.txt');
      expect(result.fileType).toBe('txt');
    });

    it('should read full content when fullContent is true', async () => {
      const filePath = path.join(tmpDir, 'full.txt');
      const lines = Array.from({ length: 300 }, (_, i) => `line ${i}`);
      await writeFile(filePath, lines.join('\n'));

      const result = await readLocalFile({ fullContent: true, path: filePath });

      expect(result.lineCount).toBe(300);
      expect(result.loc).toEqual([0, 300]);
    });

    it('should read specific line range', async () => {
      const filePath = path.join(tmpDir, 'range.txt');
      const lines = Array.from({ length: 10 }, (_, i) => `line ${i}`);
      await writeFile(filePath, lines.join('\n'));

      const result = await readLocalFile({ loc: [2, 5], path: filePath });

      expect(result.lineCount).toBe(3);
      expect(result.content).toBe('line 2\nline 3\nline 4');
      expect(result.loc).toEqual([2, 5]);
    });

    it('should handle non-existent file', async () => {
      const result = await readLocalFile({ path: path.join(tmpDir, 'nope.txt') });

      expect(result.content).toContain('Error');
      expect(result.lineCount).toBe(0);
      expect(result.totalLineCount).toBe(0);
    });

    it('should detect file type from extension', async () => {
      const filePath = path.join(tmpDir, 'code.ts');
      await writeFile(filePath, 'const x = 1;');

      const result = await readLocalFile({ path: filePath });
      expect(result.fileType).toBe('ts');
    });

    it('should handle file without extension', async () => {
      const filePath = path.join(tmpDir, 'Makefile');
      await writeFile(filePath, 'all: build');

      const result = await readLocalFile({ path: filePath });
      expect(result.fileType).toBe('unknown');
    });

    it('should include timestamps', async () => {
      const filePath = path.join(tmpDir, 'time.txt');
      await writeFile(filePath, 'content');

      const result = await readLocalFile({ path: filePath });
      expect(result.createdTime).toBeInstanceOf(Date);
      expect(result.modifiedTime).toBeInstanceOf(Date);
    });
  });

  // ─── writeLocalFile ───

  describe('writeLocalFile', () => {
    it('should write file successfully', async () => {
      const filePath = path.join(tmpDir, 'output.txt');
      const result = await writeLocalFile({ content: 'hello world', path: filePath });

      expect(result.success).toBe(true);
      expect(fs.readFileSync(filePath, 'utf8')).toBe('hello world');
    });

    it('should create parent directories', async () => {
      const filePath = path.join(tmpDir, 'sub', 'dir', 'file.txt');
      const result = await writeLocalFile({ content: 'nested', path: filePath });

      expect(result.success).toBe(true);
      expect(fs.readFileSync(filePath, 'utf8')).toBe('nested');
    });

    it('should return error for empty path', async () => {
      const result = await writeLocalFile({ content: 'data', path: '' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Path cannot be empty');
    });

    it('should return error for undefined content', async () => {
      const result = await writeLocalFile({
        content: undefined as any,
        path: path.join(tmpDir, 'f.txt'),
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Content cannot be empty');
    });
  });

  // ─── editLocalFile ───

  describe('editLocalFile', () => {
    it('should replace first occurrence by default', async () => {
      const filePath = path.join(tmpDir, 'edit.txt');
      await writeFile(filePath, 'hello world\nhello again');

      const result = await editLocalFile({
        file_path: filePath,
        new_string: 'hi',
        old_string: 'hello',
      });

      expect(result.success).toBe(true);
      expect(result.replacements).toBe(1);
      expect(fs.readFileSync(filePath, 'utf8')).toBe('hi world\nhello again');
      expect(result.diffText).toBeDefined();
      expect(result.linesAdded).toBeDefined();
      expect(result.linesDeleted).toBeDefined();
    });

    it('should replace all occurrences when replace_all is true', async () => {
      const filePath = path.join(tmpDir, 'edit-all.txt');
      await writeFile(filePath, 'hello world\nhello again');

      const result = await editLocalFile({
        file_path: filePath,
        new_string: 'hi',
        old_string: 'hello',
        replace_all: true,
      });

      expect(result.success).toBe(true);
      expect(result.replacements).toBe(2);
      expect(fs.readFileSync(filePath, 'utf8')).toBe('hi world\nhi again');
    });

    it('should return error when old_string not found', async () => {
      const filePath = path.join(tmpDir, 'no-match.txt');
      await writeFile(filePath, 'hello world');

      const result = await editLocalFile({
        file_path: filePath,
        new_string: 'hi',
        old_string: 'xyz',
      });

      expect(result.success).toBe(false);
      expect(result.replacements).toBe(0);
    });

    it('should handle special regex characters in old_string with replace_all', async () => {
      const filePath = path.join(tmpDir, 'regex.txt');
      await writeFile(filePath, 'price is $10.00 and $20.00');

      const result = await editLocalFile({
        file_path: filePath,
        new_string: '$XX.XX',
        old_string: '$10.00',
        replace_all: true,
      });

      expect(result.success).toBe(true);
      expect(fs.readFileSync(filePath, 'utf8')).toBe('price is $XX.XX and $20.00');
    });

    it('should handle non-existent file', async () => {
      const result = await editLocalFile({
        file_path: path.join(tmpDir, 'nonexistent.txt'),
        new_string: 'new',
        old_string: 'old',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should count lines added and deleted', async () => {
      const filePath = path.join(tmpDir, 'multiline.txt');
      await writeFile(filePath, 'line1\nline2\nline3');

      const result = await editLocalFile({
        file_path: filePath,
        new_string: 'newA\nnewB\nnewC\nnewD',
        old_string: 'line2',
      });

      expect(result.success).toBe(true);
      expect(result.linesAdded).toBeGreaterThan(0);
      expect(result.linesDeleted).toBeGreaterThan(0);
    });
  });

  // ─── listLocalFiles ───

  describe('listLocalFiles', () => {
    it('should list files in directory', async () => {
      await writeFile(path.join(tmpDir, 'a.txt'), 'a');
      await writeFile(path.join(tmpDir, 'b.txt'), 'b');
      await mkdir(path.join(tmpDir, 'subdir'));

      const result = await listLocalFiles({ path: tmpDir });

      expect(result.totalCount).toBe(3);
      expect(result.files.length).toBe(3);
      const names = result.files.map((f) => f.name);
      expect(names).toContain('a.txt');
      expect(names).toContain('b.txt');
      expect(names).toContain('subdir');
    });

    it('should sort by name ascending', async () => {
      await writeFile(path.join(tmpDir, 'c.txt'), 'c');
      await writeFile(path.join(tmpDir, 'a.txt'), 'a');
      await writeFile(path.join(tmpDir, 'b.txt'), 'b');

      const result = await listLocalFiles({
        path: tmpDir,
        sortBy: 'name',
        sortOrder: 'asc',
      });

      expect(result.files[0].name).toBe('a.txt');
      expect(result.files[2].name).toBe('c.txt');
    });

    it('should sort by size', async () => {
      await writeFile(path.join(tmpDir, 'small.txt'), 'x');
      await writeFile(path.join(tmpDir, 'large.txt'), 'x'.repeat(1000));

      const result = await listLocalFiles({
        path: tmpDir,
        sortBy: 'size',
        sortOrder: 'asc',
      });

      expect(result.files[0].name).toBe('small.txt');
    });

    it('should respect limit', async () => {
      await writeFile(path.join(tmpDir, 'a.txt'), 'a');
      await writeFile(path.join(tmpDir, 'b.txt'), 'b');
      await writeFile(path.join(tmpDir, 'c.txt'), 'c');

      const result = await listLocalFiles({ limit: 2, path: tmpDir });

      expect(result.files.length).toBe(2);
      expect(result.totalCount).toBe(3);
    });

    it('should handle non-existent directory', async () => {
      const result = await listLocalFiles({ path: path.join(tmpDir, 'nope') });
      expect(result.files).toEqual([]);
      expect(result.totalCount).toBe(0);
    });

    it('should mark directories correctly', async () => {
      await mkdir(path.join(tmpDir, 'mydir'));

      const result = await listLocalFiles({ path: tmpDir });
      const dir = result.files.find((f) => f.name === 'mydir');

      expect(dir!.isDirectory).toBe(true);
      expect(dir!.type).toBe('directory');
    });
  });

  // ─── moveLocalFiles ───

  describe('moveLocalFiles', () => {
    it('should move a file', async () => {
      const src = path.join(tmpDir, 'src.txt');
      const dst = path.join(tmpDir, 'dst.txt');
      await writeFile(src, 'content');

      const result = await moveLocalFiles({
        items: [{ newPath: dst, oldPath: src }],
      });

      expect(result[0].success).toBe(true);
      expect(result[0].newPath).toBe(dst);
      expect(fs.existsSync(dst)).toBe(true);
      expect(fs.existsSync(src)).toBe(false);
    });

    it('should handle identical source and target', async () => {
      const filePath = path.join(tmpDir, 'same.txt');
      await writeFile(filePath, 'content');

      const result = await moveLocalFiles({
        items: [{ newPath: filePath, oldPath: filePath }],
      });

      expect(result[0].success).toBe(true);
    });

    it('should return error for non-existent source', async () => {
      const result = await moveLocalFiles({
        items: [{ newPath: path.join(tmpDir, 'dst.txt'), oldPath: path.join(tmpDir, 'nope.txt') }],
      });

      expect(result[0].success).toBe(false);
      expect(result[0].error).toContain('Source path not found');
    });

    it('should return empty array for empty items', async () => {
      const result = await moveLocalFiles({ items: [] });
      expect(result).toEqual([]);
    });

    it('should create target directory if missing', async () => {
      const src = path.join(tmpDir, 'src.txt');
      const dst = path.join(tmpDir, 'new', 'dir', 'dst.txt');
      await writeFile(src, 'content');

      const result = await moveLocalFiles({
        items: [{ newPath: dst, oldPath: src }],
      });

      expect(result[0].success).toBe(true);
      expect(fs.existsSync(dst)).toBe(true);
    });
  });

  // ─── renameLocalFile ───

  describe('renameLocalFile', () => {
    it('should rename a file', async () => {
      const filePath = path.join(tmpDir, 'old.txt');
      await writeFile(filePath, 'content');

      const result = await renameLocalFile({ newName: 'new.txt', path: filePath });

      expect(result.success).toBe(true);
      expect(result.newPath).toBe(path.join(tmpDir, 'new.txt'));
      expect(fs.existsSync(path.join(tmpDir, 'new.txt'))).toBe(true);
    });

    it('should return error for empty params', async () => {
      const result = await renameLocalFile({ newName: '', path: '' });
      expect(result.success).toBe(false);
    });

    it('should reject invalid characters in new name', async () => {
      const result = await renameLocalFile({
        newName: 'bad/name',
        path: path.join(tmpDir, 'file.txt'),
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid new name');
    });

    it('should handle identical name (no-op)', async () => {
      const filePath = path.join(tmpDir, 'same.txt');
      await writeFile(filePath, 'content');

      const result = await renameLocalFile({ newName: 'same.txt', path: filePath });
      expect(result.success).toBe(true);
    });

    it('should return error for non-existent file', async () => {
      const result = await renameLocalFile({
        newName: 'new.txt',
        path: path.join(tmpDir, 'nope.txt'),
      });
      expect(result.success).toBe(false);
    });
  });

  // ─── globLocalFiles ───

  describe('globLocalFiles', () => {
    it('should match glob patterns', async () => {
      await writeFile(path.join(tmpDir, 'a.ts'), 'a');
      await writeFile(path.join(tmpDir, 'b.ts'), 'b');
      await writeFile(path.join(tmpDir, 'c.js'), 'c');

      const result = await globLocalFiles({ cwd: tmpDir, pattern: '*.ts' });

      expect(result.files.length).toBe(2);
      expect(result.files).toContain('a.ts');
      expect(result.files).toContain('b.ts');
    });

    it('should ignore node_modules and .git', async () => {
      await mkdir(path.join(tmpDir, 'node_modules', 'pkg'), { recursive: true });
      await writeFile(path.join(tmpDir, 'node_modules', 'pkg', 'index.ts'), 'x');
      await writeFile(path.join(tmpDir, 'src.ts'), 'y');

      const result = await globLocalFiles({ cwd: tmpDir, pattern: '**/*.ts' });

      expect(result.files).toEqual(['src.ts']);
    });
  });

  // ─── grepContent ───

  describe('grepContent', () => {
    it('should return matches', async () => {
      await writeFile(path.join(tmpDir, 'search.txt'), 'hello world\nfoo bar\nhello again');

      const result = await grepContent({ cwd: tmpDir, pattern: 'hello' });

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('matches');
    });

    it('should handle no matches', async () => {
      await writeFile(path.join(tmpDir, 'empty.txt'), 'nothing here');

      const result = await grepContent({ cwd: tmpDir, pattern: 'xyz_not_found' });
      expect(result.matches).toEqual([]);
    });
  });

  // ─── searchLocalFiles ───

  describe('searchLocalFiles', () => {
    it('should find files by keyword', async () => {
      await writeFile(path.join(tmpDir, 'config.json'), '{}');
      await writeFile(path.join(tmpDir, 'config.yaml'), '');
      await writeFile(path.join(tmpDir, 'readme.md'), '');

      const result = await searchLocalFiles({ directory: tmpDir, keywords: 'config' });

      expect(result.length).toBe(2);
      expect(result.map((r) => r.name)).toContain('config.json');
    });

    it('should respect limit', async () => {
      for (let i = 0; i < 5; i++) {
        await writeFile(path.join(tmpDir, `file${i}.log`), `content ${i}`);
      }

      const result = await searchLocalFiles({
        directory: tmpDir,
        keywords: 'file',
        limit: 2,
      });

      expect(result.length).toBe(2);
    });

    it('should handle errors gracefully', async () => {
      const result = await searchLocalFiles({
        directory: '/nonexistent/path/xyz',
        keywords: 'test',
      });

      expect(result).toEqual([]);
    });
  });
});
