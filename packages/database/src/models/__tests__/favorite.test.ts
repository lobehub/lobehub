// @vitest-environment node
import { FAVORITE_LIMIT } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { tasks, userFavorites, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { FavoriteLimitError, FavoriteModel } from '../favorite';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'favorite-test-user';
const otherUserId = 'favorite-test-user-2';
const workspaceId = 'favorite-test-ws';

const personalModel = new FavoriteModel(serverDB, userId);
const workspaceModel = new FavoriteModel(serverDB, userId, workspaceId);

const topic = (id: string, title = id) => ({
  path: `/agent/agt_a/${id}`,
  targetId: id,
  title,
  type: 'topic' as const,
});

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.delete(workspaces);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB
    .insert(workspaces)
    .values([{ id: workspaceId, name: 'Test WS', primaryOwnerId: userId, slug: 'favorite-ws' }]);
});

afterEach(async () => {
  await serverDB.delete(userFavorites);
  await serverDB.delete(tasks);
  await serverDB.delete(users);
  await serverDB.delete(workspaces);
});

describe('FavoriteModel', () => {
  it('puts each new favorite at the top', async () => {
    await personalModel.add(topic('tpc_1'));
    await personalModel.add(topic('tpc_2'));
    await personalModel.add({
      path: '/projects',
      targetId: '/projects',
      title: 'Projects',
      type: 'route',
    });

    const items = await personalModel.query();
    expect(items.map((item) => item.targetId)).toEqual(['/projects', 'tpc_2', 'tpc_1']);
    expect(items[2]).toMatchObject({ icon: null, path: '/agent/agt_a/tpc_1', type: 'topic' });
  });

  it('keeps a dragged order and still puts the next favorite on top', async () => {
    const a = await personalModel.add(topic('tpc_a'));
    const b = await personalModel.add(topic('tpc_b'));
    const c = await personalModel.add(topic('tpc_c'));

    await personalModel.reorder([a.id, c.id, b.id]);
    await personalModel.add(topic('tpc_d'));
    // Refreshing an existing favorite does not move it to the top.
    await personalModel.add(topic('tpc_b', 'Renamed'));

    const items = await personalModel.query();
    expect(items.map((item) => item.targetId)).toEqual(['tpc_d', 'tpc_a', 'tpc_c', 'tpc_b']);
    expect(items[3].title).toBe('Renamed');
  });

  it('refreshes an existing favorite in place instead of duplicating it', async () => {
    await personalModel.add(topic('tpc_1', 'Old'));
    await personalModel.add(topic('tpc_2'));
    await personalModel.add({ ...topic('tpc_1', 'New'), icon: '🚀', path: '/group/cg_a/tpc_1' });

    const items = await personalModel.query();
    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({
      icon: '🚀',
      path: '/group/cg_a/tpc_1',
      targetId: 'tpc_1',
      title: 'New',
    });
  });

  it('carries the current status of a favorited task', async () => {
    await serverDB.insert(tasks).values([
      {
        createdByUserId: userId,
        id: 'task_personal',
        identifier: 'T-1',
        instruction: 'x',
        seq: 1,
        status: 'running',
      },
      {
        createdByUserId: userId,
        id: 'task_ws',
        identifier: 'T-2',
        instruction: 'x',
        seq: 2,
        status: 'paused',
        workspaceId,
      },
      {
        createdByUserId: otherUserId,
        id: 'task_private',
        identifier: 'T-3',
        instruction: 'x',
        seq: 3,
        status: 'failed',
        visibility: 'private',
        workspaceId,
      },
      {
        createdByUserId: userId,
        id: 'task_trashed',
        identifier: 'T-4',
        instruction: 'x',
        isDeleted: true,
        seq: 4,
        status: 'running',
      },
    ]);
    const task = (id: string) => ({
      path: `/task/${id}`,
      targetId: id,
      title: id,
      type: 'task' as const,
    });

    expect(await personalModel.add(task('task_personal'))).toMatchObject({ status: 'running' });
    await personalModel.add(topic('tpc_1'));
    // A task from another scope, or one that no longer exists, has no status to show.
    await personalModel.add(task('task_ws'));
    await personalModel.add(task('task_gone'));
    // A task in the recycle bin is not a live task either.
    await personalModel.add(task('task_trashed'));
    await workspaceModel.add(task('task_ws'));
    // Another member's private task stays hidden, status included.
    expect(await workspaceModel.add(task('task_private'))).not.toHaveProperty('status');

    const items = await personalModel.query();
    expect(items.map((item) => [item.targetId, item.status])).toEqual([
      ['task_trashed', undefined],
      ['task_gone', undefined],
      ['task_ws', undefined],
      ['tpc_1', undefined],
      ['task_personal', 'running'],
    ]);

    await serverDB.update(tasks).set({ status: 'completed' });
    const statusOf = (rows: Awaited<ReturnType<FavoriteModel['query']>>, targetId: string) =>
      rows.find((row) => row.targetId === targetId)?.status;
    expect(statusOf(await personalModel.query(), 'task_personal')).toBe('completed');
    expect(statusOf(await workspaceModel.query(), 'task_ws')).toBe('completed');
  });

  it('keeps personal, workspace and other members’ favorites apart', async () => {
    await personalModel.add(topic('tpc_personal'));
    await workspaceModel.add(topic('tpc_ws'));
    // The same target can be favorited in both sidebars.
    await workspaceModel.add(topic('tpc_personal'));
    await new FavoriteModel(serverDB, otherUserId, workspaceId).add(topic('tpc_other'));

    expect((await personalModel.query()).map((item) => item.targetId)).toEqual(['tpc_personal']);
    expect((await workspaceModel.query()).map((item) => item.targetId)).toEqual([
      'tpc_personal',
      'tpc_ws',
    ]);
  });

  it('removes only rows in the caller’s scope', async () => {
    const own = await workspaceModel.add(topic('tpc_1'));
    const other = await new FavoriteModel(serverDB, otherUserId, workspaceId).add(topic('tpc_1'));

    await workspaceModel.remove(other.id);
    expect(await new FavoriteModel(serverDB, otherUserId, workspaceId).query()).toHaveLength(1);

    await workspaceModel.remove(own.id);
    expect(await workspaceModel.query()).toHaveLength(0);
  });

  it('stops adding at the limit a reorder can still carry, but keeps refreshing existing rows', async () => {
    await serverDB.insert(userFavorites).values(
      Array.from({ length: FAVORITE_LIMIT }, (_, index) => ({
        path: `/page/docs_${index}`,
        sortOrder: index,
        targetId: `docs_${index}`,
        title: `Page ${index}`,
        type: 'page' as const,
        userId,
      })),
    );

    await expect(personalModel.add(topic('tpc_over'))).rejects.toBeInstanceOf(FavoriteLimitError);
    await personalModel.add({
      path: '/page/docs_0',
      targetId: 'docs_0',
      title: 'Renamed',
      type: 'page',
    });
    // Another sidebar has its own allowance.
    await workspaceModel.add(topic('tpc_ws'));

    const items = await personalModel.query();
    expect(items).toHaveLength(FAVORITE_LIMIT);
    expect(items[0].title).toBe('Renamed');
  });

  it('lets only one of two concurrent adds take the last free slot', async () => {
    await serverDB.insert(userFavorites).values(
      Array.from({ length: FAVORITE_LIMIT - 1 }, (_, index) => ({
        path: `/page/docs_${index}`,
        sortOrder: index,
        targetId: `docs_${index}`,
        title: `Page ${index}`,
        type: 'page' as const,
        userId,
      })),
    );

    const results = await Promise.allSettled([
      personalModel.add(topic('tpc_first')),
      personalModel.add(topic('tpc_second')),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await personalModel.query()).toHaveLength(FAVORITE_LIMIT);
  });

  it('removes by target', async () => {
    await personalModel.add(topic('tpc_1'));
    await personalModel.add(topic('tpc_2'));

    await personalModel.removeByTarget('topic', 'tpc_1');

    expect((await personalModel.query()).map((item) => item.targetId)).toEqual(['tpc_2']);
  });

  it('reorders, keeping favorites added since the caller read the list on top', async () => {
    const a = await personalModel.add(topic('tpc_a'));
    const b = await personalModel.add(topic('tpc_b'));
    const c = await personalModel.add(topic('tpc_c'));
    const foreign = await workspaceModel.add(topic('tpc_ws'));

    await personalModel.reorder([c.id, foreign.id, a.id]);

    expect((await personalModel.query()).map((item) => item.id)).toEqual([b.id, c.id, a.id]);
    expect((await workspaceModel.query()).map((item) => item.id)).toEqual([foreign.id]);
  });

  it('ignores a reorder while this sidebar holds no favorites', async () => {
    const item = await personalModel.add(topic('tpc_keep'));

    await expect(workspaceModel.reorder([item.id, 'tpc_missing'])).resolves.toBeUndefined();

    expect(await workspaceModel.query()).toEqual([]);
    expect((await personalModel.query()).map((row) => row.id)).toEqual([item.id]);
  });

  it('leaves the scope untouched when it has no favorites to reorder', async () => {
    const foreign = await workspaceModel.add(topic('tpc_ws'));

    await personalModel.reorder([foreign.id]);

    expect(await personalModel.query()).toEqual([]);
    expect((await workspaceModel.query()).map((item) => item.id)).toEqual([foreign.id]);
  });

  it('updates the snapshot of a favorite in scope', async () => {
    const item = await personalModel.add(topic('tpc_1', 'Old'));

    await personalModel.update(item.id, { icon: '📄', title: 'Renamed' });

    expect((await personalModel.query())[0]).toMatchObject({ icon: '📄', title: 'Renamed' });
  });
});
