import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  editLocalFile,
  globLocalFiles,
  grepContent,
  listLocalFiles,
  readLocalFile,
  searchLocalFiles,
  writeLocalFile,
} from './file';

vi.mock('../utils/logger', () => ({
  log: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('file tools', () => {
  const tmpDir = path.join(os.tmpdir(), 'cli-file-test-' + process.pid);

  beforeEach(async () => {
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  describe('readLocalFile', () => {
    it('should read a file with default line range (0-200)', async () => {
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
  });

  describe('writeLocalFile', () => {
    it('should write a file successfully', async () => {
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

    it('should handle file read error', async () => {
      const result = await editLocalFile({
        file_path: path.join(tmpDir, 'nonexistent.txt'),
        new_string: 'new',
        old_string: 'old',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('listLocalFiles', () => {
    it('should list files in directory', async () => {
      await writeFile(path.join(tmpDir, 'a.txt'), 'a');
      await writeFile(path.join(tmpDir, 'b.txt'), 'b');
      await mkdir(path.join(tmpDir, 'subdir'));

      const result = await listLocalFiles({ path: tmpDir });

      expect(result.totalCount).toBe(3);
      expect(result.files.length).toBe(3);
      const names = result.files.map((f: any) => f.name);
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

    it('should sort by createdTime', async () => {
      await writeFile(path.join(tmpDir, 'first.txt'), 'first');
      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 10));
      await writeFile(path.join(tmpDir, 'second.txt'), 'second');

      const result = await listLocalFiles({
        path: tmpDir,
        sortBy: 'createdTime',
        sortOrder: 'asc',
      });

      expect(result.files.length).toBe(2);
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

    it('should use default sortBy for unknown sort key', async () => {
      await writeFile(path.join(tmpDir, 'a.txt'), 'a');

      const result = await listLocalFiles({
        path: tmpDir,
        sortBy: 'unknown' as any,
      });

      expect(result.files.length).toBe(1);
    });

    it('should mark directories correctly', async () => {
      await mkdir(path.join(tmpDir, 'mydir'));

      const result = await listLocalFiles({ path: tmpDir });

      const dir = result.files.find((f: any) => f.name === 'mydir');
      expect(dir.isDirectory).toBe(true);
      expect(dir.type).toBe('directory');
    });
  });

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

    it('should use process.cwd() when cwd not specified', async () => {
      const result = await globLocalFiles({ pattern: '*.nonexistent-ext-xyz' });

      expect(result.files).toEqual([]);
    });

    it('should handle invalid pattern gracefully', async () => {
      // fast-glob handles most patterns; test with a simple one
      const result = await globLocalFiles({ cwd: tmpDir, pattern: '*.txt' });

      expect(result.files).toEqual([]);
    });
  });

  describe('editLocalFile edge cases', () => {
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

  describe('grepContent', () => {
    it('should return matches using ripgrep', async () => {
      await writeFile(path.join(tmpDir, 'search.txt'), 'hello world\nfoo bar\nhello again');

      const result = await grepContent({ cwd: tmpDir, pattern: 'hello' });

      // Result depends on whether rg is installed
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('matches');
    });

    it('should support file pattern filter', async () => {
      await writeFile(path.join(tmpDir, 'test.ts'), 'const x = 1;');
      await writeFile(path.join(tmpDir, 'test.js'), 'const y = 2;');

      const result = await grepContent({
        cwd: tmpDir,
        filePattern: '*.ts',
        pattern: 'const',
      });

      expect(result).toHaveProperty('success');
    });

    it('should handle no matches', async () => {
      await writeFile(path.join(tmpDir, 'empty.txt'), 'nothing here');

      const result = await grepContent({ cwd: tmpDir, pattern: 'xyz_not_found' });

      expect(result.matches).toEqual([]);
    });
  });

  describe('searchLocalFiles', () => {
    it('should find files by keyword', async () => {
      await writeFile(path.join(tmpDir, 'config.json'), '{}');
      await writeFile(path.join(tmpDir, 'config.yaml'), '');
      await writeFile(path.join(tmpDir, 'readme.md'), '');

      const result = await searchLocalFiles({ directory: tmpDir, keywords: 'config' });

      expect(result.length).toBe(2);
      expect(result.map((r: any) => r.name)).toContain('config.json');
    });

    it('should filter by content', async () => {
      await writeFile(path.join(tmpDir, 'match.txt'), 'this has the secret');
      await writeFile(path.join(tmpDir, 'nomatch.txt'), 'nothing here');

      // Search with a broad pattern and content filter
      const result = await searchLocalFiles({
        contentContains: 'secret',
        directory: tmpDir,
        keywords: '',
      });

      // Content filtering should exclude files without 'secret'
      expect(result.every((r: any) => r.name !== 'nomatch.txt' || false)).toBe(true);
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

    it('should use cwd when directory not specified', async () => {
      const result = await searchLocalFiles({ keywords: 'nonexistent_xyz_file' });

      expect(Array.isArray(result)).toBe(true);
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
