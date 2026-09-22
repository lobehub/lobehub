import { createHash } from 'node:crypto';
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

describe('LocalFileCtr — hashLocalFile', () => {
  const tmpDir = path.join(os.tmpdir(), 'localfilectr-hash-test-' + process.pid);

  beforeEach(async () => {
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  it('returns the sha256 hex of the file content', async () => {
    const filePath = path.join(tmpDir, 'blob.bin');
    const content = Buffer.alloc(3 * 1024 * 1024, 7);
    await writeFile(filePath, content);

    const hash = await new LocalFileCtr(mockApp).hashLocalFile({ path: filePath });

    expect(hash).toBe(createHash('sha256').update(content).digest('hex'));
  });

  it('rejects when the file does not exist', async () => {
    await expect(
      new LocalFileCtr(mockApp).hashLocalFile({ path: path.join(tmpDir, 'missing') }),
    ).rejects.toThrow();
  });
});
