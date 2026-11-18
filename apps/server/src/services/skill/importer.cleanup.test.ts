// @vitest-environment node
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';

import type { LobeChatDatabase } from '@lobechat/database';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TempFileManager } from '@/server/utils/tempFileManager';

import { SkillImporter } from './importer';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  downloadFileToLocal: vi.fn(),
  parseZipPackage: vi.fn(),
}));
vi.mock('@/database/models/agentSkill', () => ({
  AgentSkillModel: class {
    create = mocks.create;
    findByName = vi.fn().mockResolvedValue(undefined);
  },
}));
vi.mock('@/server/modules/GitHub', () => ({
  GitHub: class {},
  GitHubNotFoundError: class extends Error {},
  GitHubParseError: class extends Error {},
}));
vi.mock('@/server/services/file', () => ({
  FileService: class {
    downloadFileToLocal = mocks.downloadFileToLocal;
  },
}));
vi.mock('./resource', () => ({ SkillResourceService: class {} }));
vi.mock('./parser', () => ({
  SkillParser: class {
    parseZipPackage = mocks.parseZipPackage;
  },
}));

let root: string;
let manager: TempFileManager;
beforeEach(async () => {
  vi.resetAllMocks();
  root = await mkdtemp(path.join(tmpdir(), 'skill-import-cleanup-'));
  manager = new TempFileManager(path.join(path.relative(tmpdir(), root), 'zip-'));
});
afterEach(async () => {
  await manager.cleanup();
  await rm(root, { force: true, recursive: true });
});

describe('SkillImporter ZIP temp file cleanup', () => {
  it.each([false, true])(
    'waits for the actual cleanup before the import settles (parse fails = %s)',
    async (fails) => {
      const bytes = Buffer.from('downloaded ZIP bytes');
      const filePath = await manager.writeTempFile(bytes, 'skill.zip');
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let entered!: () => void;
      const cleaning = new Promise<void>((resolve) => {
        entered = resolve;
      });
      mocks.downloadFileToLocal.mockResolvedValue({
        cleanup: async () => {
          entered();
          await gate;
          await manager.cleanup();
        },
        filePath,
      });
      const failure = new Error('invalid ZIP');
      if (fails) mocks.parseZipPackage.mockRejectedValue(failure);
      else {
        mocks.parseZipPackage.mockResolvedValue({
          content: 'skill content',
          manifest: { name: 'Imported skill' },
          resources: new Map(),
        });
        mocks.create.mockResolvedValue({ id: 'created' });
      }

      let settled = false;
      const result = new SkillImporter({} as LobeChatDatabase, 'owner')
        .importFromZip({ zipFileId: 'zip-id' })
        .then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        )
        .finally(() => {
          settled = true;
        });
      try {
        await cleaning;
        await setImmediate();
        expect(mocks.parseZipPackage).toHaveBeenCalledWith(bytes);
        expect(settled).toBe(false);
        expect((await stat(filePath)).isFile()).toBe(true);
      } finally {
        release();
        await result;
        await manager.cleanup();
      }

      if (fails) expect(await result).toEqual({ error: failure });
      else expect(await result).toMatchObject({ value: { status: 'created' } });
      expect(await readdir(root)).toEqual([]);
    },
  );
});
