// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TaskModel } from '../task';
import { TaskArchiveModel } from '../taskArchive';
import { TaskTopicModel } from '../taskTopic';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'task-bulk-model-test-user-id';
const otherUserId = 'task-bulk-model-test-other-user-id';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

/** Bulk writers used by the task list's batch actions. */
describe('task bulk model methods', () => {
  const setup = async () => {
    const mine = new TaskModel(serverDB, userId);
    const theirs = new TaskModel(serverDB, otherUserId);
    const a = await mine.create({ instruction: 'A' });
    const b = await mine.create({ instruction: 'B' });
    const foreign = await theirs.create({ instruction: 'Foreign' });
    return { a, b, foreign, mine, theirs };
  };

  it('updateFieldsForIds writes every owned row and never another user’s', async () => {
    const { a, b, foreign, mine, theirs } = await setup();

    const updated = await mine.updateFieldsForIds([a.id, b.id, foreign.id], { priority: 1 });

    expect(updated.map((task) => task.id).sort()).toEqual([a.id, b.id].sort());
    expect((await mine.findById(b.id))?.priority).toBe(1);
    expect((await theirs.findById(foreign.id))?.priority).toBe(0);
    expect(await mine.updateFieldsForIds([], { priority: 1 })).toEqual([]);
  });

  it('updateFieldsForIds rewrites only the configs it was handed, in the same statement', async () => {
    const { a, b, foreign, mine, theirs } = await setup();

    const updated = await mine.updateFieldsForIds(
      [a.id, b.id],
      { priority: 2 },
      new Map<string, unknown>([
        [a.id, { repo: 'lobehub/lobehub' }],
        [b.id, null],
        // Not part of this edit: its config must not be rewritten.
        [foreign.id, { repo: 'elsewhere' }],
      ]),
    );

    expect(updated.map((task) => task.id).sort()).toEqual([a.id, b.id].sort());
    expect((await mine.findById(a.id))?.config).toEqual({ repo: 'lobehub/lobehub' });
    expect((await mine.findById(b.id))?.config).toBeNull();
    // Untouched: a config for an id outside `ids` never reaches the statement.
    expect((await theirs.findById(foreign.id))?.config).toEqual({});
  });

  it('lockForBulkEdit asks the database for nothing when it is handed no ids', async () => {
    expect(await new TaskModel(serverDB, userId).lockForBulkEdit([])).toEqual([]);
  });

  it('lockForBulkEdit returns only owned rows with the columns a bulk edit decides on', async () => {
    const { a, foreign, mine } = await setup();

    const locked = await serverDB.transaction((tx) =>
      new TaskModel(tx, userId).lockForBulkEdit([a.id, foreign.id]),
    );

    expect(locked).toHaveLength(1);
    expect(locked[0]).toMatchObject({
      archivedAt: null,
      createdByUserId: userId,
      id: a.id,
      status: 'backlog',
      visibility: (await mine.findById(a.id))?.visibility,
    });
  });

  it('deleteIfStatusForIds deletes only rows still in the expected status', async () => {
    const { a, b, foreign, mine, theirs } = await setup();
    await mine.update(b.id, { status: 'running' });

    const deleted = await mine.deleteIfStatusForIds([
      { id: a.id, status: 'backlog' },
      { id: b.id, status: 'backlog' },
      { id: foreign.id, status: 'backlog' },
    ]);

    expect(deleted).toEqual([a.id]);
    expect(await mine.findById(b.id)).not.toBeNull();
    expect(await theirs.findById(foreign.id)).not.toBeNull();
    expect(await mine.deleteIfStatusForIds([])).toEqual([]);
  });

  it('archiveMany / unarchiveMany apply the guard per row and stay in scope', async () => {
    const { a, b, foreign, mine, theirs } = await setup();
    await mine.update(b.id, { status: 'running' });
    const archive = new TaskArchiveModel(serverDB, userId);

    const archived = await archive.archiveMany([a.id, b.id, foreign.id]);
    expect(archived.map((task) => task.id)).toEqual([a.id]);
    expect((await theirs.findById(foreign.id))?.archivedAt).toBeNull();

    const restored = await archive.unarchiveMany([a.id, foreign.id]);
    expect(restored.map((task) => task.id)).toEqual([a.id]);
    expect(await archive.archiveMany([])).toEqual([]);
  });

  it('findByTaskIds lists topic links of owned tasks only', async () => {
    const { a, foreign } = await setup();
    const topics = new TaskTopicModel(serverDB, userId);

    expect(await topics.findByTaskIds([])).toEqual([]);
    expect(await topics.findByTaskIds([a.id, foreign.id])).toEqual([]);
  });

  it('updateStatusIfCurrentForIds moves only rows still in the inspected status', async () => {
    const { a, b, foreign, mine, theirs } = await setup();
    await mine.update(b.id, { status: 'completed' });

    const updated = await mine.updateStatusIfCurrentForIds(
      [
        { id: a.id, status: 'backlog' },
        { id: b.id, status: 'running' },
        { id: foreign.id, status: 'backlog' },
      ],
      'paused',
    );

    expect(updated).toEqual([a.id]);
    expect((await mine.findById(a.id))?.status).toBe('paused');
    expect((await mine.findById(b.id))?.status).toBe('completed');
    expect((await theirs.findById(foreign.id))?.status).toBe('backlog');
    expect(await mine.updateStatusIfCurrentForIds([], 'paused')).toEqual([]);
  });
});
