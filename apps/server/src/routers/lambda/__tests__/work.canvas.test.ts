// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkModel } from '@/database/models/work';
import { users, workspaces } from '@/database/schemas';
import { createCanvasStorageService } from '@/server/services/canvas';

import { workRouter } from '../work';

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
  return { wsCompatProcedure: trpc.procedure };
});

vi.mock('@/business/server/trpc-middlewares/rbacPermission', async () => {
  const { trpc } = await import('@/libs/trpc/lambda/init');
  return { withScopedPermission: () => trpc.middleware((opts) => opts.next()) };
});

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async (opts: { next: (input: unknown) => unknown }) =>
    opts.next({ ctx: { serverDB } }),
}));

const userId = 'work-canvas-cleanup-user';
const caller = (id = userId, workspaceId?: string) =>
  workRouter.createCaller({ serverDB, userId: id, workspaceId });

beforeEach(async () => {
  objects.clear();
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: 'work-canvas-stranger' }]);
});

const createCanvas = async () => {
  const storage = createCanvasStorageService(serverDB, userId);
  const model = new WorkModel(serverDB, userId);
  let workId = '';
  for (const content of ['first', 'second']) {
    const result = await storage.commit('cvs_cleanup', [
      { content: `<html><body>${content}</body></html>`, path: 'index.html' },
    ]);
    if (!result.ok) throw new Error('commit failed');
    const work = await model.registerCanvas({
      canvasId: 'cvs_cleanup',
      metadata: result.metadata,
      title: 'Cleanup',
      toolCallId: `cleanup-${content}`,
      toolIdentifier: 'lobe-canvas',
      toolName: 'createCanvas',
    });
    workId = work.id;
  }
  return { model, workId };
};

describe('workRouter.deleteWork · Canvas storage', () => {
  it('removes all manifests after the Work and its versions are deleted', async () => {
    const { model, workId } = await createCanvas();
    expect([...objects.keys()].filter((key) => key.includes('/manifests/'))).toHaveLength(2);

    await caller().deleteWork({ id: workId });

    expect(await model.findCanvas('cvs_cleanup')).toBeNull();
    expect(await model.listVersions(workId)).toEqual([]);
    expect(objects.size).toBe(0);
  });

  it('preserves another user’s Canvas and stored objects', async () => {
    const { model, workId } = await createCanvas();
    const keys = [...objects.keys()].sort();

    await caller('work-canvas-stranger').deleteWork({ id: workId });

    expect(await model.findCanvas('cvs_cleanup')).not.toBeNull();
    expect([...objects.keys()].sort()).toEqual(keys);
  });

  it.each([
    [undefined, 'canvas-cleanup-ws-a'],
    ['canvas-cleanup-ws-a', undefined],
    ['canvas-cleanup-ws-a', 'canvas-cleanup-ws-b'],
  ])(
    'preserves a manifest shared between %s and %s until both works are deleted',
    async (from, to) => {
      await serverDB.insert(workspaces).values(
        ['canvas-cleanup-ws-a', 'canvas-cleanup-ws-b'].map((id) => ({
          id,
          name: id,
          primaryOwnerId: userId,
          slug: id,
        })),
      );
      const registrations = [];
      for (const workspaceId of [from, to]) {
        const storage = createCanvasStorageService(serverDB, userId, workspaceId);
        const result = await storage.commit('cvs_shared', [
          { content: '<html><body>Shared Canvas</body></html>', path: 'index.html' },
        ]);
        if (!result.ok) throw new Error('commit failed');
        const work = await new WorkModel(serverDB, userId, workspaceId).registerCanvas({
          canvasId: 'cvs_shared',
          metadata: result.metadata,
          title: 'Shared Canvas',
          toolCallId: `shared-${workspaceId ?? 'personal'}`,
          toolIdentifier: 'lobe-canvas',
          toolName: 'createCanvas',
        });
        registrations.push({ manifestKey: result.metadata.manifestKey, storage, work });
      }
      const [first, second] = registrations;
      expect(first.manifestKey).toBe(second.manifestKey);

      await caller(userId, from).deleteWork({ id: first.work.id });

      const manifest = await second.storage.readManifest(second.manifestKey);
      const file = await second.storage.readFile(manifest, 'index.html');
      expect(new TextDecoder().decode(file?.bytes)).toContain('Shared Canvas');

      await caller(userId, to).deleteWork({ id: second.work.id });

      expect(objects.size).toBe(0);
    },
  );
});
