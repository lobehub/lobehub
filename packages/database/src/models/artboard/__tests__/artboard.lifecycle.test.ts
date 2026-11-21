// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { artboardPages, projects, tasks, users, workspaces } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { ArtboardModel } from '../index';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'artboard-lifecycle-user';
const otherUserId = 'artboard-lifecycle-other';
const workspaceId = 'artboard-lifecycle-ws';
const taskIds = ['task_alc_1', 'task_alc_2'];

const model = new ArtboardModel(serverDB, userId);
const inWorkspace = new ArtboardModel(serverDB, userId, workspaceId);

const cleanup = async () => {
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
};

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: 'WS', primaryOwnerId: userId, slug: workspaceId });
  await serverDB.insert(projects).values({ id: 'prj_alc', name: 'Onboarding', userId });
  await serverDB.insert(tasks).values([
    {
      createdByUserId: userId,
      id: 'task_alc_1',
      identifier: 'A-1',
      instruction: 'design onboarding',
      seq: 1,
    },
    {
      createdByUserId: userId,
      id: 'task_alc_2',
      identifier: 'A-2',
      instruction: 'design onboarding',
      seq: 2,
    },
  ]);
});

afterEach(async () => {
  await serverDB.delete(tasks).where(inArray(tasks.id, taskIds));
  await serverDB.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await cleanup();
});

const create = (target = model, taskId = 'task_alc_1') =>
  target.create({ projectId: 'prj_alc', taskId, title: '新用户首次进入项目' });

describe('ArtboardModel · lifecycle', () => {
  it('creates the artboard and its first page inside the caller transaction', async () => {
    const artboard = await serverDB.transaction(async (tx) => {
      const scoped = model.withTransaction(tx);
      const created = await create(scoped);
      const pages = await tx
        .select()
        .from(artboardPages)
        .where(eq(artboardPages.artboardId, created.id));
      expect(pages).toHaveLength(1);
      // The scoped model reports the owner of the caller, not the tx.
      expect(await scoped.findById(created.id)).toMatchObject({ userId });
      return created;
    });

    expect(await model.findById(artboard.id)).toMatchObject({ id: artboard.id });
  });

  it('moves updatedAt on a file-only write without bumping the structure revision', async () => {
    const artboard = await create();
    const before = (await model.getRevision(artboard.id))!;

    const touched = await model.touch(artboard.id);
    const after = (await model.getRevision(artboard.id))!;

    expect(touched?.revision).toBe(before.revision);
    expect(after.revision).toBe(before.revision);
    expect(new Date(after.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(before.updatedAt).getTime(),
    );
    expect(await model.getRevision('art_missing')).toBeUndefined();
    expect(await model.touch('art_missing')).toBeUndefined();
  });

  it('reaches boards under a trashed task only through the recycle-bin helpers', async () => {
    const trashed = await create(model, 'task_alc_1');
    const kept = await create(model, 'task_alc_2');
    await serverDB.update(tasks).set({ isDeleted: true }).where(eq(tasks.id, 'task_alc_1'));

    expect(await model.findById(trashed.id)).toBeUndefined();
    expect(await model.listByTrashedTaskIds([])).toEqual([]);
    expect((await model.listByTrashedTaskIds(['task_alc_1'])).map((row) => row.id)).toEqual([
      trashed.id,
    ]);
    expect(await inWorkspace.listByTrashedTaskIds(['task_alc_1'])).toEqual([]);

    await model.deleteForTrashPurge([]);
    expect(await model.findById(kept.id)).toBeDefined();

    await model.deleteForTrashPurge([trashed.id]);
    const remaining = await serverDB
      .select()
      .from(artboardPages)
      .where(eq(artboardPages.artboardId, trashed.id));
    expect(remaining).toEqual([]);
  });

  it('does not purge a board owned by another user', async () => {
    const artboard = await create();
    await serverDB.update(tasks).set({ isDeleted: true }).where(eq(tasks.id, 'task_alc_1'));

    const stranger = new ArtboardModel(serverDB, otherUserId);
    await stranger.deleteForTrashPurge([artboard.id]);

    expect(await model.listByTrashedTaskIds(['task_alc_1'])).toHaveLength(1);
  });
});
