// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { CanvasFileModel } from '../../../models/canvasFile';
import { FileModel } from '../../../models/file';
import { users, workspaceMembers, workspaces } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { CanvasFileRepository } from '../index';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'canvas-file-user';
const otherUserId = 'canvas-file-user-2';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

const blob = (hash: string, size = 10) => ({
  contentType: 'text/html',
  hash,
  name: 'index.html',
  size,
  url: `canvas/${userId}/blobs/${hash}`,
});

describe('CanvasFileRepository', () => {
  it('registers one file row per canvas blob and counts it toward storage usage', async () => {
    const repository = new CanvasFileRepository(serverDB, userId);
    await repository.register('cvs_a', [blob('h1', 100), blob('h2', 50)]);
    await repository.register('cvs_a', [blob('h1', 100)]);
    const model = new CanvasFileModel(serverDB, userId);

    expect(
      (await model.listByHashes(['h1', 'h2'])).map((row) => [row.canvasId, row.fileHash]),
    ).toEqual(
      expect.arrayContaining([
        ['cvs_a', 'h1'],
        ['cvs_a', 'h2'],
      ]),
    );
    expect(await new FileModel(serverDB, userId).countUsage()).toBe(150);
  });

  it('keeps blobs owned per user', async () => {
    await new CanvasFileRepository(serverDB, userId).register('cvs_a', [blob('h1')]);

    expect(await new CanvasFileModel(serverDB, otherUserId).listByHashes(['h1'])).toEqual([]);
  });

  it('does not reuse a teammate canvas blob in a shared workspace', async () => {
    const workspaceId = 'canvas-file-ws';
    await serverDB
      .insert(workspaces)
      .values({ id: workspaceId, name: 'ws', primaryOwnerId: userId, slug: workspaceId });
    await serverDB.insert(workspaceMembers).values([
      { role: 'owner', userId, workspaceId },
      { role: 'editor', userId: otherUserId, workspaceId },
    ]);
    await new CanvasFileRepository(serverDB, userId, workspaceId).register('cvs_a', [blob('h1')]);

    expect(
      await new CanvasFileModel(serverDB, otherUserId, workspaceId).listByHashes(['h1']),
    ).toEqual([]);
  });

  it('removes a canvas and reports blobs no other canvas still uses', async () => {
    const repository = new CanvasFileRepository(serverDB, userId);
    await repository.register('cvs_a', [blob('shared'), blob('only-a')]);
    await repository.register('cvs_b', [blob('shared')]);
    const model = new CanvasFileModel(serverDB, userId);

    const orphaned = await model.deleteByCanvas('cvs_a');

    expect(orphaned).toEqual([`canvas/${userId}/blobs/only-a`]);
    expect((await model.listByHashes(['shared', 'only-a'])).map((row) => row.canvasId)).toEqual([
      'cvs_b',
    ]);
  });

  it.each([
    [undefined, 'canvas-ws-a'],
    ['canvas-ws-a', undefined],
    ['canvas-ws-a', 'canvas-ws-b'],
  ])('preserves shared blobs when deleting from %s while %s still uses them', async (from, to) => {
    await serverDB.insert(workspaces).values(
      ['canvas-ws-a', 'canvas-ws-b'].map((id) => ({
        id,
        name: id,
        primaryOwnerId: userId,
        slug: id,
      })),
    );
    await new CanvasFileRepository(serverDB, userId, from).register('cvs_a', [
      blob('shared'),
      blob('only-a'),
    ]);
    await new CanvasFileRepository(serverDB, userId, to).register('cvs_b', [blob('shared')]);

    expect(await new CanvasFileModel(serverDB, userId, from).deleteByCanvas('cvs_a')).toEqual([
      `canvas/${userId}/blobs/only-a`,
    ]);
    const remaining = new CanvasFileModel(serverDB, userId, to);
    expect(await remaining.listByHashes(['shared'])).toHaveLength(1);
    expect(await remaining.deleteByCanvas('cvs_b')).toEqual([`canvas/${userId}/blobs/shared`]);
  });
});
