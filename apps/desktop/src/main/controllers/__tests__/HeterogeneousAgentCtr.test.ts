import { access, mkdtemp, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { on: vi.fn() },
  ipcMain: { handle: vi.fn() },
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    verbose: vi.fn(),
    warn: vi.fn(),
  }),
}));

import HeterogeneousAgentCtr from '../HeterogeneousAgentCtr';

describe('HeterogeneousAgentCtr', () => {
  let appStoragePath: string;

  beforeEach(async () => {
    appStoragePath = await mkdtemp(path.join(tmpdir(), 'lobehub-hetero-'));
  });

  afterEach(async () => {
    await rm(appStoragePath, { force: true, recursive: true });
  });

  describe('resolveImage', () => {
    it('stores traversal-looking ids inside the cache root via a stable hash key', async () => {
      const ctr = new HeterogeneousAgentCtr({ appStoragePath } as any);
      const cacheDir = path.join(appStoragePath, 'heteroAgent/files');
      const escapedTargetName = `${path.basename(appStoragePath)}-outside-storage`;
      const escapePath = path.join(cacheDir, `../../../${escapedTargetName}`);

      try {
        await unlink(escapePath);
      } catch {}

      await (ctr as any).resolveImage({
        id: `../../../${escapedTargetName}`,
        url: 'data:text/plain;base64,T1VUU0lERQ==',
      });

      const cacheEntries = await readdir(cacheDir);

      expect(cacheEntries).toHaveLength(2);
      expect(cacheEntries.every((entry) => /^[a-f0-9]{64}(\.meta)?$/.test(entry))).toBe(true);
      await expect(access(escapePath)).rejects.toThrow();

      try {
        await unlink(escapePath);
      } catch {}
    });

    it('does not trust pre-seeded out-of-root traversal cache files as cache hits', async () => {
      const ctr = new HeterogeneousAgentCtr({ appStoragePath } as any);
      const cacheDir = path.join(appStoragePath, 'heteroAgent/files');
      const traversalId = '../../preexisting-secret';
      const outOfRootDataPath = path.join(cacheDir, traversalId);
      const outOfRootMetaPath = path.join(cacheDir, `${traversalId}.meta`);

      await writeFile(outOfRootDataPath, 'SECRET');
      await writeFile(outOfRootMetaPath, JSON.stringify({ id: traversalId, mimeType: 'text/plain' }));

      const result = await (ctr as any).resolveImage({
        id: traversalId,
        url: 'data:text/plain;base64,SUdOT1JFRA==',
      });

      expect(Buffer.from(result.buffer).toString('utf8')).toBe('IGNORED');
      expect(result.mimeType).toBe('text/plain');
      await expect(readFile(outOfRootDataPath, 'utf8')).resolves.toBe('SECRET');
    });
  });
});
