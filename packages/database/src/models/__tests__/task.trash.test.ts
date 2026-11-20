// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TaskModel } from '../task';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'task-trash-user';
const otherUserId = 'task-trash-user-2';
const workspaceId = 'task-trash-ws';
const otherWorkspaceId = 'task-trash-ws-2';

const personal = new TaskModel(serverDB, userId);
const workspace = new TaskModel(serverDB, userId, workspaceId);
const member = new TaskModel(serverDB, otherUserId, workspaceId);

const deletedAt = new Date('2026-11-01T00:00:00Z');
const stamp = { deletedAt };

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(workspaces).values([
    { id: workspaceId, name: 'WS', primaryOwnerId: userId, slug: workspaceId },
    { id: otherWorkspaceId, name: 'WS 2', primaryOwnerId: userId, slug: otherWorkspaceId },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('TaskModel recycle bin', () => {
  describe('softDeleteIfStatusForIds', () => {
    it('stamps only the rows still sitting on the status the caller decided on', async () => {
      const done = await personal.create({ instruction: 'done', status: 'done' });
      const backlog = await personal.create({ instruction: 'backlog' });

      const stamped = await personal.softDeleteIfStatusForIds(
        [
          // `done` moved on since the caller read it, so the compare-and-set loses.
          { id: done.id, status: 'backlog' },
          { id: backlog.id, status: 'backlog' },
        ],
        stamp,
      );

      expect(stamped.map((task) => task.id)).toEqual([backlog.id]);
      expect(stamped[0]).toMatchObject({ deletedAt, isDeleted: true });

      const live = await personal.findById(done.id);
      expect(live?.isDeleted).toBeNull();
      expect(live?.deletedAt).toBeNull();
    });

    it('leaves rows already in the bin alone and is a no-op for an empty list', async () => {
      const task = await personal.create({ instruction: 'a' });
      await personal.softDeleteIfStatusForIds([{ id: task.id, status: 'backlog' }], stamp);

      expect(
        await personal.softDeleteIfStatusForIds([{ id: task.id, status: 'backlog' }], {
          deletedAt: new Date('2026-11-02T00:00:00Z'),
        }),
      ).toEqual([]);
      expect(await personal.softDeleteIfStatusForIds([], stamp)).toEqual([]);

      const [row] = await personal.findTrashedByIds([task.id]);
      // The first stamp wins; the second call never touched the row.
      expect(row).toMatchObject({ deletedAt, isDeleted: true });
    });

    it('never stamps a personal task of another owner', async () => {
      const theirs = await new TaskModel(serverDB, otherUserId).create({ instruction: 'theirs' });

      expect(
        await personal.softDeleteIfStatusForIds([{ id: theirs.id, status: 'backlog' }], stamp),
      ).toEqual([]);
      expect(await new TaskModel(serverDB, otherUserId).findById(theirs.id)).toMatchObject({
        isDeleted: null,
      });
    });

    it("skips a teammate's private task the caller cannot see", async () => {
      const secret = await member.create({ instruction: 'secret', visibility: 'private' });
      const shared = await workspace.create({ instruction: 'shared', visibility: 'public' });

      const stamped = await workspace.softDeleteIfStatusForIds(
        [
          { id: secret.id, status: 'backlog' },
          { id: shared.id, status: 'backlog' },
        ],
        stamp,
      );

      expect(stamped.map((task) => task.id)).toEqual([shared.id]);
      expect(await member.findById(secret.id)).toMatchObject({ isDeleted: null });
    });
  });

  describe('restore', () => {
    it('brings stamped rows back and ignores live ones', async () => {
      const trashed = await personal.create({ instruction: 'trashed' });
      const live = await personal.create({ instruction: 'live' });
      await personal.softDeleteIfStatusForIds([{ id: trashed.id, status: 'backlog' }], stamp);

      const restored = await personal.restore([trashed.id, live.id]);

      expect(restored.map((task) => task.id)).toEqual([trashed.id]);
      expect(restored[0]).toMatchObject({ deletedAt: null, isDeleted: null });
      // A restored row is indistinguishable from one that was never trashed.
      expect(await personal.findById(trashed.id)).toMatchObject({ status: 'backlog' });
    });

    it('is a no-op for an empty list and stays in scope', async () => {
      const theirs = await new TaskModel(serverDB, otherUserId).create({ instruction: 'theirs' });
      await new TaskModel(serverDB, otherUserId).softDeleteIfStatusForIds(
        [{ id: theirs.id, status: 'backlog' }],
        stamp,
      );

      expect(await personal.restore([])).toEqual([]);
      expect(await personal.restore([theirs.id])).toEqual([]);
      expect(await new TaskModel(serverDB, otherUserId).findTrashedIds([theirs.id])).toEqual([
        theirs.id,
      ]);
    });
  });

  describe('findTrashedByIds / findTrashedIds', () => {
    it('reads the bin through the scope without the recycle-bin filter', async () => {
      const trashed = await personal.create({ instruction: 'trashed' });
      const live = await personal.create({ instruction: 'live' });
      await personal.softDeleteIfStatusForIds([{ id: trashed.id, status: 'backlog' }], stamp);

      expect((await personal.findTrashedByIds([trashed.id, live.id])).map((t) => t.id)).toEqual([
        trashed.id,
      ]);
      expect(await personal.findTrashedIds([trashed.id, live.id])).toEqual([trashed.id]);
      expect(await personal.findTrashedByIds([])).toEqual([]);
      expect(await personal.findTrashedIds([])).toEqual([]);
    });

    it('hides a teammate private task from the bin query', async () => {
      const secret = await member.create({ instruction: 'secret', visibility: 'private' });
      await member.softDeleteIfStatusForIds([{ id: secret.id, status: 'backlog' }], stamp);

      expect(await workspace.findTrashedByIds([secret.id])).toEqual([]);
      expect(await workspace.findTrashedIds([secret.id])).toEqual([]);
      expect((await member.findTrashedByIds([secret.id])).map((t) => t.id)).toEqual([secret.id]);
    });
  });

  describe('purge', () => {
    it('hard deletes stamped rows only and reports their ids', async () => {
      const trashed = await personal.create({ instruction: 'trashed' });
      const live = await personal.create({ instruction: 'live' });
      await personal.softDeleteIfStatusForIds([{ id: trashed.id, status: 'backlog' }], stamp);

      expect(await personal.purge([trashed.id, live.id])).toEqual([trashed.id]);
      expect(await personal.findById(trashed.id)).toBeNull();
      expect(await personal.findById(live.id)).toMatchObject({ status: 'backlog' });
      // Purged rows are gone, so a second sweep reports nothing.
      expect(await personal.purge([trashed.id])).toEqual([]);
      expect(await personal.purge([])).toEqual([]);
    });

    it('never purges another scope row', async () => {
      const theirs = await new TaskModel(serverDB, otherUserId).create({ instruction: 'theirs' });
      await new TaskModel(serverDB, otherUserId).softDeleteIfStatusForIds(
        [{ id: theirs.id, status: 'backlog' }],
        stamp,
      );

      expect(await personal.purge([theirs.id])).toEqual([]);
      expect(await personal.purge([])).toEqual([]);
      expect(await new TaskModel(serverDB, otherUserId).findById(theirs.id)).toBeNull();
    });
  });
});
