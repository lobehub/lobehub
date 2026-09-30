import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type App } from '@/core/App';

import LocalFileCtr from '../LocalFileCtr';

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  ipcMain: { handle: vi.fn() },
  shell: { openPath: vi.fn() },
}));

vi.mock('execa', () => ({ execa: vi.fn() }));
vi.mock('@/utils/net-fetch', () => ({ netFetch: vi.fn() }));
vi.mock('@/utils/file-system', () => ({ makeSureDirExist: vi.fn() }));

const mockApp = {
  appStoragePath: '/mock/app/storage',
  getService: vi.fn(),
  toolDetectorManager: { getBestTool: vi.fn(() => null) },
} as unknown as App;

describe('LocalFileCtr — getLocalFileStats', () => {
  const tmpDir = path.join(os.tmpdir(), 'localfilectr-stats-test-' + process.pid);

  beforeEach(async () => {
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  it('reports size and line count for a text file', async () => {
    const filePath = path.join(tmpDir, 'data.csv');
    const content = Array.from({ length: 200_000 }, (_, index) => `row,${index}`).join('\n');
    await writeFile(filePath, content);

    const stats = await new LocalFileCtr(mockApp).getLocalFileStats({ path: filePath });

    expect(stats).toMatchObject({ lineCount: 200_000, size: Buffer.byteLength(content) });
  });

  it('does not count an extra line after a trailing newline', async () => {
    const filePath = path.join(tmpDir, 'notes.txt');
    await writeFile(filePath, 'a\nb\n');

    const stats = await new LocalFileCtr(mockApp).getLocalFileStats({ path: filePath });

    expect(stats.lineCount).toBe(2);
  });

  it('skips line counting for binary files', async () => {
    const filePath = path.join(tmpDir, 'blob.bin');
    await writeFile(filePath, Buffer.from([0x00, 0x0a, 0x01, 0x0a, 0x00]));

    const stats = await new LocalFileCtr(mockApp).getLocalFileStats({ path: filePath });

    expect(stats.lineCount).toBeUndefined();
    expect(stats.size).toBe(5);
  });

  it('skips line counting for UTF-16 files', async () => {
    const filePath = path.join(tmpDir, 'export.csv');
    const content = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('a,b\nc,d\n', 'utf16le'),
    ]);
    await writeFile(filePath, content);

    const stats = await new LocalFileCtr(mockApp).getLocalFileStats({ path: filePath });

    expect(stats.lineCount).toBeUndefined();
    expect(stats.size).toBe(content.length);
  });

  it('rejects when the file does not exist', async () => {
    await expect(
      new LocalFileCtr(mockApp).getLocalFileStats({ path: path.join(tmpDir, 'missing') }),
    ).rejects.toThrow();
  });
});
