// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { GoalModel } from '../goal';
import { GoalGraphModel } from '../goalGraph';
import { TaskModel } from '../task';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'goal-bulk-user';
const otherUserId = 'goal-bulk-other';

const goalModel = new GoalModel(serverDB, userId);
const graphModel = new GoalGraphModel(serverDB, userId);
const taskModel = new TaskModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('GoalGraphModel.findGoalsByTaskIds', () => {
  it('asks the database for nothing when it is handed no tasks', async () => {
    expect(await graphModel.findGoalsByTaskIds([])).toEqual(new Map());
  });

  it('returns nothing for tasks that no longer exist', async () => {
    // The ancestor walk yields no row, so the goal query is skipped entirely.
    expect(await graphModel.findGoalsByTaskIds(['missing-task-id'])).toEqual(new Map());
  });

  it('maps every task to its nearest goal and leaves tasks without one absent', async () => {
    const parent = await taskModel.create({ instruction: 'parent' });
    const child = await taskModel.create({ instruction: 'child', parentTaskId: parent.id });
    const loose = await taskModel.create({ instruction: 'no goal' });

    // Carried by the parent: one level above the child.
    const carried = await goalModel.create({
      createdAt: new Date('2026-01-01T00:00:00Z'),
      subjectId: parent.id,
      subjectType: 'task',
      title: 'Carried by parent',
    });
    // Bound to the child itself: depth 0, so it wins over the carried goal.
    const bound = await goalModel.create({
      createdAt: new Date('2026-02-01T00:00:00Z'),
      subjectType: 'standalone',
      title: 'Bound to child',
    });
    const node = await graphModel.createNode(bound.id, { kind: 'task', title: 'Bound' });
    await graphModel.bindTask(bound.id, node!.id, child.id);

    const goals = await graphModel.findGoalsByTaskIds([child.id, loose.id]);

    expect(goals.get(child.id)).toEqual({
      id: bound.id,
      status: bound.status,
      title: 'Bound to child',
    });
    expect(goals.has(loose.id)).toBe(false);
    expect(goals.size).toBe(1);

    // The parent is its own root: the carried goal sits at depth 0 for it.
    const forParent = await graphModel.findGoalsByTaskIds([parent.id]);
    expect(forParent.get(parent.id)).toEqual({
      id: carried.id,
      status: carried.status,
      title: 'Carried by parent',
    });
  });

  it('prefers the newest goal when two sit at the same distance', async () => {
    const task = await taskModel.create({ instruction: 'shared' });

    await goalModel.create({
      createdAt: new Date('2026-01-01T00:00:00Z'),
      subjectId: task.id,
      subjectType: 'task',
      title: 'Older goal',
    });
    const newer = await goalModel.create({
      createdAt: new Date('2026-02-01T00:00:00Z'),
      subjectType: 'standalone',
      title: 'Newer goal',
    });
    const node = await graphModel.createNode(newer.id, { kind: 'task', title: 'Shared' });
    await graphModel.bindTask(newer.id, node!.id, task.id);

    expect((await graphModel.findGoalsByTaskIds([task.id])).get(task.id)?.id).toBe(newer.id);
  });

  it('replaces a farther goal with a nearer one found later', async () => {
    const grandparent = await taskModel.create({ instruction: 'grandparent' });
    const parent = await taskModel.create({ instruction: 'parent', parentTaskId: grandparent.id });
    const leaf = await taskModel.create({ instruction: 'leaf', parentTaskId: parent.id });

    // Carried two levels above the leaf.
    await goalModel.create({
      createdAt: new Date('2026-03-01T00:00:00Z'),
      subjectId: grandparent.id,
      subjectType: 'task',
      title: 'Far but newer',
    });
    // Carried one level above the leaf: nearer, even though it is older.
    const nearer = await goalModel.create({
      createdAt: new Date('2026-01-01T00:00:00Z'),
      subjectId: parent.id,
      subjectType: 'task',
      title: 'Near but older',
    });

    const goals = await graphModel.findGoalsByTaskIds([leaf.id]);

    expect(goals.get(leaf.id)?.id).toBe(nearer.id);
  });

  it('ignores a goal carried by a task outside the walked chain', async () => {
    const task = await taskModel.create({ instruction: 'bound' });
    const elsewhere = await taskModel.create({ instruction: 'carrier outside the chain' });
    // A node binding puts the row in scope; its carrier is not an ancestor of `task`.
    const goal = await goalModel.create({
      subjectId: elsewhere.id,
      subjectType: 'task',
      title: 'Carried elsewhere',
    });
    const node = await graphModel.createNode(goal.id, { kind: 'task', title: 'Bound' });
    await graphModel.bindTask(goal.id, node!.id, task.id);

    const goals = await graphModel.findGoalsByTaskIds([task.id]);

    expect(goals.get(task.id)?.id).toBe(goal.id);
    expect(goals.has(elsewhere.id)).toBe(false);
  });

  it("never reaches another user's goals", async () => {
    const task = await taskModel.create({ instruction: 'mine' });
    const otherTask = await new TaskModel(serverDB, otherUserId).create({ instruction: 'theirs' });
    const otherGoal = await new GoalModel(serverDB, otherUserId).create({
      subjectId: otherTask.id,
      subjectType: 'task',
      title: 'Their goal',
    });

    const goals = await graphModel.findGoalsByTaskIds([task.id, otherTask.id]);

    expect(goals.has(task.id)).toBe(false);
    expect(goals.has(otherTask.id)).toBe(false);
    expect(goals.get(otherTask.id)).not.toMatchObject({ id: otherGoal.id });
  });
});
