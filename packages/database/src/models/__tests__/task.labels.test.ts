// @vitest-environment node
import { TASK_LIST_FILTER_NONE } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TaskModel } from '../task';
import { TaskLabelModel } from '../taskLabel';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'task-labels-list-user';
const workspaceId = 'task-labels-list-ws';

const tasks = new TaskModel(serverDB, userId, workspaceId);
const labels = new TaskLabelModel(serverDB, userId, workspaceId);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.delete(workspaces);
  await serverDB.insert(users).values([{ id: userId }]);
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: 'WS', primaryOwnerId: userId, slug: workspaceId });
});

afterEach(async () => {
  await serverDB.delete(users);
  await serverDB.delete(workspaces);
});

const seed = async () => {
  const type = await labels.create({ isGroup: true, name: 'Type' });
  const bug = await labels.create({ name: 'Bug', parentId: type.id, sortOrder: 1 });
  const feature = await labels.create({ name: 'Feature', parentId: type.id, sortOrder: 2 });
  const frontend = await labels.create({ name: 'Frontend' });
  const t1 = await tasks.create({ instruction: 'bug + fe', name: 't1' });
  const t2 = await tasks.create({ instruction: 'feature', name: 't2' });
  const t3 = await tasks.create({ instruction: 'none', name: 't3' });
  await labels.addTaskLabels(t1.id, [bug.id, frontend.id]);
  await labels.addTaskLabels(t2.id, [feature.id]);
  return { bug, feature, frontend, t1, t2, t3, type };
};

const names = (rows: { name: string | null }[]) => rows.map((r) => r.name).sort();

describe('task list label filter', () => {
  it('matches labels, label groups and "no labels"', async () => {
    const { bug, frontend, type } = await seed();
    const list = async (values: string[], operator: 'is' | 'isNot' = 'is') =>
      names((await tasks.list({ filter: { label: { operator, values } } })).tasks);

    expect(await list([bug.id])).toEqual(['t1']);
    expect(await list([type.id])).toEqual(['t1', 't2']);
    expect(await list([TASK_LIST_FILTER_NONE])).toEqual(['t3']);
    expect(await list([frontend.id, TASK_LIST_FILTER_NONE])).toEqual(['t1', 't3']);
    expect(await list([frontend.id], 'isNot')).toEqual(['t2', 't3']);
    expect(await list([TASK_LIST_FILTER_NONE], 'isNot')).toEqual(['t1', 't2']);
    // a malformed id matches nothing instead of failing the query
    expect(await list(['not-a-uuid'])).toEqual([]);
  });

  it('attaches labels to list and grouped rows', async () => {
    const { t1 } = await seed();
    const { tasks: rows } = await tasks.list();
    // registry order: sortOrder, then name
    expect(rows.find((t) => t.id === t1.id)?.labels?.map((l) => l.name)).toEqual([
      'Frontend',
      'Bug',
    ]);
    expect(rows.find((t) => t.name === 't3')?.labels).toEqual([]);
  });
});

describe('task board grouped by label group', () => {
  it('puts each task in its group label column, then "no label"', async () => {
    const { bug, feature, type } = await seed();
    const groups = await tasks.groupList({ groupBy: 'label', labelGroupId: type.id });

    expect(groups.map((g) => g.key)).toEqual([
      `label:${bug.id}`,
      `label:${feature.id}`,
      'label:none',
    ]);
    expect(groups.map((g) => g.labelId)).toEqual([bug.id, feature.id, null]);
    expect(groups.map((g) => names(g.tasks))).toEqual([['t1'], ['t2'], ['t3']]);
    expect(groups.map((g) => g.total)).toEqual([1, 1, 1]);
    expect(groups[0].tasks[0].labels?.map((l) => l.name)).toEqual(['Frontend', 'Bug']);
  });

  it('keeps empty label columns as drop targets', async () => {
    const { type } = await seed();
    const chore = await labels.create({ name: 'Chore', parentId: type.id, sortOrder: 3 });
    const groups = await tasks.groupList({ groupBy: 'label', labelGroupId: type.id });

    expect(groups.find((g) => g.labelId === chore.id)).toMatchObject({ tasks: [], total: 0 });
  });

  it('refuses a label that is not a group', async () => {
    const { frontend } = await seed();
    await expect(
      tasks.groupList({ groupBy: 'label', labelGroupId: frontend.id }),
    ).rejects.toThrow();
  });
});
