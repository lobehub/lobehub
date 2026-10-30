// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { tasks, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TaskModel } from '../task';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'task-closed-after-test-user-id';
const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

/**
 * An old backlog task, a completed task from each side of a one-week window,
 * and canceled tasks with no `completedAt` dated only by `updatedAt`.
 */
const seed = async (model: TaskModel) => {
  const backlog = await model.create({ instruction: 'Old backlog task' });
  const recentDone = await model.create({ instruction: 'Completed yesterday' });
  const staleDone = await model.create({ instruction: 'Completed last month' });
  const recentCanceled = await model.create({ instruction: 'Canceled yesterday' });
  const staleCanceled = await model.create({ instruction: 'Canceled last month' });

  await serverDB
    .update(tasks)
    .set({ updatedAt: daysAgo(60) })
    .where(eq(tasks.id, backlog.id));
  await serverDB
    .update(tasks)
    .set({ completedAt: daysAgo(1), status: 'completed', updatedAt: daysAgo(1) })
    .where(eq(tasks.id, recentDone.id));
  // updatedAt is recent (e.g. a later edit), but completedAt decides.
  await serverDB
    .update(tasks)
    .set({ completedAt: daysAgo(30), status: 'completed', updatedAt: daysAgo(1) })
    .where(eq(tasks.id, staleDone.id));
  await serverDB
    .update(tasks)
    .set({ completedAt: null, status: 'canceled', updatedAt: daysAgo(1) })
    .where(eq(tasks.id, recentCanceled.id));
  await serverDB
    .update(tasks)
    .set({ completedAt: null, status: 'canceled', updatedAt: daysAgo(30) })
    .where(eq(tasks.id, staleCanceled.id));

  return { backlog, recentCanceled, recentDone, staleCanceled, staleDone };
};

describe('TaskModel closedAfter', () => {
  it('list keeps unfinished tasks and only the tasks closed after the cut', async () => {
    const model = new TaskModel(serverDB, userId);
    const seeded = await seed(model);

    const all = await model.list();
    expect(all.total).toBe(5);

    const windowed = await model.list({ closedAfter: daysAgo(7) });
    expect(windowed.tasks.map((task) => task.id).sort()).toEqual(
      [seeded.backlog.id, seeded.recentCanceled.id, seeded.recentDone.id].sort(),
    );
    // The cut happens before pagination, so `total` counts the same set.
    expect(windowed.total).toBe(3);
  });

  it('groupList narrows the closed columns by the same cut', async () => {
    const model = new TaskModel(serverDB, userId);
    const seeded = await seed(model);
    const groups = [
      { key: 'backlog', statuses: ['backlog'] },
      { key: 'done', statuses: ['completed'] },
      { key: 'canceled', statuses: ['canceled'] },
    ];

    const result = await model.groupList({ closedAfter: daysAgo(7), groups });
    const byKey = new Map(result.map((group) => [group.key, group]));

    expect(byKey.get('backlog')?.tasks.map((task) => task.id)).toEqual([seeded.backlog.id]);
    expect(byKey.get('done')?.tasks.map((task) => task.id)).toEqual([seeded.recentDone.id]);
    expect(byKey.get('done')?.total).toBe(1);
    expect(byKey.get('canceled')?.tasks.map((task) => task.id)).toEqual([seeded.recentCanceled.id]);
    expect(byKey.get('canceled')?.total).toBe(1);
  });
});
