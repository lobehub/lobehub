// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TaskModel } from '../task';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'task-archive-test-user-id';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

const seed = async (model: TaskModel) => {
  const active = await model.create({ instruction: 'Active task' });
  const archived = await model.create({ instruction: 'Archived task' });
  await model.updateStatus(archived.id, 'completed', { completedAt: new Date() });
  await model.update(archived.id, { archivedAt: new Date() });
  return { active, archived };
};

describe('TaskModel archived tasks', () => {
  it('persists and clears archivedAt through update without touching status', async () => {
    const model = new TaskModel(serverDB, userId);
    const { archived } = await seed(model);

    const stored = await model.findById(archived.id);
    expect(stored?.archivedAt).toBeInstanceOf(Date);
    expect(stored?.status).toBe('completed');

    const restored = await model.update(archived.id, { archivedAt: null });
    expect(restored?.archivedAt).toBeNull();
    expect(restored?.status).toBe('completed');
  });

  it('hides archived tasks from list unless includeArchived is set', async () => {
    const model = new TaskModel(serverDB, userId);
    const { active, archived } = await seed(model);

    const hidden = await model.list();
    expect(hidden.tasks.map((task) => task.id)).toEqual([active.id]);
    expect(hidden.total).toBe(1);

    const shown = await model.list({ includeArchived: true });
    expect(shown.tasks.map((task) => task.id).sort()).toEqual([active.id, archived.id].sort());
    expect(shown.total).toBe(2);
  });

  it('hides archived tasks from groupList unless includeArchived is set', async () => {
    const model = new TaskModel(serverDB, userId);
    const { active, archived } = await seed(model);
    const groups = [
      { key: 'backlog', statuses: ['backlog'] },
      { key: 'done', statuses: ['completed'] },
    ];

    const hidden = await model.groupList({ groups });
    expect(hidden.find((group) => group.key === 'done')?.total).toBe(0);
    expect(hidden.find((group) => group.key === 'backlog')?.tasks.map((task) => task.id)).toEqual([
      active.id,
    ]);

    const shown = await model.groupList({ groups, includeArchived: true });
    const done = shown.find((group) => group.key === 'done');
    expect(done?.total).toBe(1);
    expect(done?.tasks.map((task) => task.id)).toEqual([archived.id]);
  });
});
