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

describe('file tools (integration wrapper)', () => {
  const tmpDir = path.join(os.tmpdir(), 'cli-file-test-' + process.pid);

  beforeEach(async () => {
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  it('should re-export readLocalFile from shared package', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    await writeFile(filePath, 'hello world');

    const result = await readLocalFile({ path: filePath });

    expect(result.filename).toBe('test.txt');
    expect(result.content).toBe('hello world');
  });

  it('should re-export writeLocalFile from shared package', async () => {
    const filePath = path.join(tmpDir, 'output.txt');

    const result = await writeLocalFile({ content: 'written', path: filePath });

    expect(result.success).toBe(true);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('written');
  });

  it('should re-export editLocalFile from shared package', async () => {
    const filePath = path.join(tmpDir, 'edit.txt');
    await writeFile(filePath, 'hello world');

    const result = await editLocalFile({
      file_path: filePath,
      new_string: 'hi',
      old_string: 'hello',
    });

    expect(result.success).toBe(true);
    expect(result.replacements).toBe(1);
  });

  it('should re-export listLocalFiles from shared package', async () => {
    await writeFile(path.join(tmpDir, 'a.txt'), 'a');

    const result = await listLocalFiles({ path: tmpDir });

    expect(result.totalCount).toBeGreaterThan(0);
  });

  it('should re-export globLocalFiles from shared package', async () => {
    await writeFile(path.join(tmpDir, 'a.ts'), 'a');
    await writeFile(path.join(tmpDir, 'b.js'), 'b');

    const result = await globLocalFiles({ cwd: tmpDir, pattern: '*.ts' });

    expect(result.files).toContain('a.ts');
    expect(result.files).not.toContain('b.js');
  });

  it('should re-export grepContent from shared package', async () => {
    await writeFile(path.join(tmpDir, 'search.txt'), 'hello world');

    const result = await grepContent({ cwd: tmpDir, pattern: 'hello' });

    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('matches');
  });

  it('should re-export searchLocalFiles from shared package', async () => {
    await writeFile(path.join(tmpDir, 'config.json'), '{}');

    const result = await searchLocalFiles({ directory: tmpDir, keywords: 'config' });

    expect(result.length).toBe(1);
  });
});
