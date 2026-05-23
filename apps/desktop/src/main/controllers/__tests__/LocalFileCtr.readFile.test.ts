import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type App } from '@/core/App';

import LocalFileCtr from '../LocalFileCtr';

// Real fs + real @lobechat/file-loaders end-to-end. We only mock the
// boundaries we genuinely cannot run in a test process: electron IPC,
// execa shell-outs, logger, net fetch.
vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  ipcMain: { handle: vi.fn() },
  shell: { openPath: vi.fn() },
}));

vi.mock('execa', () => ({ execa: vi.fn() }));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('@/utils/net-fetch', () => ({ netFetch: vi.fn() }));

vi.mock('@/utils/file-system', () => ({ makeSureDirExist: vi.fn() }));

const mockApp = {
  appStoragePath: '/mock/app/storage',
  getService: vi.fn(),
  toolDetectorManager: { getBestTool: vi.fn(() => null) },
} as unknown as App;

describe('LocalFileCtr — readFile / readFiles (real fs)', () => {
  const tmpDir = path.join(os.tmpdir(), 'localfilectr-readfile-test-' + process.pid);
  let localFileCtr: LocalFileCtr;

  beforeEach(async () => {
    vi.clearAllMocks();
    await mkdir(tmpDir, { recursive: true });
    localFileCtr = new LocalFileCtr(mockApp);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  describe('readFile', () => {
    it('should read file successfully with default location', async () => {
      const filePath = path.join(tmpDir, 'test.txt');
      const content = 'line1\nline2\nline3\nline4\nline5';
      await writeFile(filePath, content);

      const result = await localFileCtr.readFile({ path: filePath });

      expect(result).toEqual({
        charCount: 29,
        content,
        createdTime: expect.any(Date),
        fileType: 'txt',
        filename: 'test.txt',
        lineCount: 5,
        loc: [0, 200],
        modifiedTime: expect.any(Date),
        totalCharCount: 29,
        totalLineCount: 5,
      });
    });

    it('should read file with custom location range', async () => {
      const filePath = path.join(tmpDir, 'range.txt');
      await writeFile(filePath, 'line1\nline2\nline3\nline4\nline5');

      const result = await localFileCtr.readFile({ loc: [1, 3], path: filePath });

      expect(result).toEqual({
        charCount: 11,
        content: 'line2\nline3',
        createdTime: expect.any(Date),
        fileType: 'txt',
        filename: 'range.txt',
        lineCount: 2,
        loc: [1, 3],
        modifiedTime: expect.any(Date),
        totalCharCount: 29,
        totalLineCount: 5,
      });
    });

    it('should read full file content when fullContent is true', async () => {
      const filePath = path.join(tmpDir, 'full.txt');
      const content = 'line1\nline2\nline3\nline4\nline5';
      await writeFile(filePath, content);

      const result = await localFileCtr.readFile({ fullContent: true, path: filePath });

      expect(result).toEqual({
        charCount: 29,
        content,
        createdTime: expect.any(Date),
        fileType: 'txt',
        filename: 'full.txt',
        lineCount: 5,
        loc: [0, 5],
        modifiedTime: expect.any(Date),
        totalCharCount: 29,
        totalLineCount: 5,
      });
    });

    it('should handle file read error', async () => {
      const result = await localFileCtr.readFile({
        path: path.join(tmpDir, 'does-not-exist.txt'),
      });

      expect(result).toEqual({
        charCount: 0,
        content: expect.stringContaining('Error accessing or processing file'),
        createdTime: expect.any(Date),
        fileType: 'txt',
        filename: 'does-not-exist.txt',
        lineCount: 0,
        loc: [0, 0],
        modifiedTime: expect.any(Date),
        totalCharCount: 0,
        totalLineCount: 0,
      });
    });
  });

  describe('readFiles', () => {
    it('should read multiple files successfully', async () => {
      const file1 = path.join(tmpDir, 'a.txt');
      const file2 = path.join(tmpDir, 'b.txt');
      await writeFile(file1, 'content a');
      await writeFile(file2, 'content b');

      const result = await localFileCtr.readFiles({ paths: [file1, file2] });

      expect(result).toEqual([
        {
          charCount: 9,
          content: 'content a',
          createdTime: expect.any(Date),
          fileType: 'txt',
          filename: 'a.txt',
          lineCount: 1,
          loc: [0, 200],
          modifiedTime: expect.any(Date),
          totalCharCount: 9,
          totalLineCount: 1,
        },
        {
          charCount: 9,
          content: 'content b',
          createdTime: expect.any(Date),
          fileType: 'txt',
          filename: 'b.txt',
          lineCount: 1,
          loc: [0, 200],
          modifiedTime: expect.any(Date),
          totalCharCount: 9,
          totalLineCount: 1,
        },
      ]);
    });
  });
});
