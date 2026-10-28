// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FileModel } from '@/database/models/file';
import { WorkModel } from '@/database/models/work';
import { users } from '@/database/schemas';
import { createCanvasStorageService } from '@/server/services/canvas';

import { canvasRouter } from '../canvas';

const serverDB = await getTestDB();
const objects = vi.hoisted(() => new Map<string, Uint8Array>());

vi.mock('@/server/services/file', () => ({
  FileService: class {
    async deleteFiles(keys: string[]) {
      for (const key of keys) objects.delete(key);
    }

    async getFileByteArray(key: string) {
      const bytes = objects.get(key);
      if (!bytes) throw new Error(`Missing ${key}`);
      return bytes;
    }

    async uploadBuffer(key: string, bytes: Uint8Array) {
      objects.set(key, bytes);
    }
  },
}));

vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const { trpc } = await import('@/libs/trpc/lambda/init');
  return {
    requireWorkspaceRoleWhenScoped: () => trpc.middleware((opts) => opts.next()),
    wsCompatProcedure: trpc.procedure,
  };
});

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async (opts: { next: (input: unknown) => unknown }) =>
    opts.next({ ctx: { serverDB } }),
}));

const userId = 'canvas-storage-user';
const strangerId = 'canvas-storage-stranger';
const caller = (id = userId) => canvasRouter.createCaller({ serverDB, userId: id });

beforeEach(async () => {
  objects.clear();
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: strangerId }]);
});

const commit = async (canvasId: string, html: string) => {
  const result = await createCanvasStorageService(serverDB, userId).commit(canvasId, [
    { content: html, path: 'index.html' },
  ]);
  if (!result.ok) throw new Error('commit failed');
  return result.metadata;
};

const createCanvas = async (canvasId: string, title: string) => {
  const model = new WorkModel(serverDB, userId);
  let workId = '';
  for (const body of ['first', 'second']) {
    const work = await model.registerCanvas({
      canvasId,
      metadata: await commit(canvasId, `<html><body>${title} ${body}</body></html>`),
      title,
      toolCallId: `${canvasId}-${body}`,
      toolIdentifier: 'lobe-canvas',
      toolName: 'createCanvas',
    });
    workId = work.id;
  }
  return { model, workId };
};

describe('canvasRouter storage', () => {
  it('lists each canvas once with the size of every version it stored', async () => {
    const { workId } = await createCanvas('cvs_storage', 'Climate Alarm');
    const usage = await new FileModel(serverDB, userId).countUsage();

    expect(await caller().listStorage()).toEqual([
      expect.objectContaining({
        canvasId: 'cvs_storage',
        fileCount: 2,
        title: 'Climate Alarm',
        totalSize: usage,
        workId,
      }),
    ]);
  });

  it('frees the storage a canvas holds when it is deleted', async () => {
    const { model, workId } = await createCanvas('cvs_storage', 'Climate Alarm');
    expect(await new FileModel(serverDB, userId).countUsage()).toBeGreaterThan(0);

    await caller().delete({ canvasId: 'cvs_storage' });

    expect(await new FileModel(serverDB, userId).countUsage()).toBe(0);
    expect(await model.findCanvas('cvs_storage')).toBeNull();
    expect(await model.listVersions(workId)).toEqual([]);
    expect(await caller().listStorage()).toEqual([]);
    expect(objects.size).toBe(0);
  });

  it('frees files a canvas left behind without a Work', async () => {
    await commit('cvs_orphan', '<html><body>never registered</body></html>');
    expect(await caller().listStorage()).toEqual([
      expect.objectContaining({ canvasId: 'cvs_orphan', title: null, workId: null }),
    ]);

    await caller().delete({ canvasId: 'cvs_orphan' });

    expect(await new FileModel(serverDB, userId).countUsage()).toBe(0);
    expect([...objects.keys()].filter((key) => key.includes('/blobs/'))).toEqual([]);
  });

  it('leaves another user’s canvas and its storage alone', async () => {
    const { model } = await createCanvas('cvs_storage', 'Climate Alarm');
    const usage = await new FileModel(serverDB, userId).countUsage();
    const keys = [...objects.keys()].sort();

    expect(await caller(strangerId).listStorage()).toEqual([]);
    await caller(strangerId).delete({ canvasId: 'cvs_storage' });

    expect(await new FileModel(serverDB, userId).countUsage()).toBe(usage);
    expect(await model.findCanvas('cvs_storage')).not.toBeNull();
    expect([...objects.keys()].sort()).toEqual(keys);
  });
});
