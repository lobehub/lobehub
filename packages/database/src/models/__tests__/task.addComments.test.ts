// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TaskModel } from '../task';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'task-add-comments-user';
const otherUserId = 'task-add-comments-other';
const workspaceId = 'task-add-comments-ws';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('TaskModel.addComments', () => {
  it('adds every row to the task with its visibility, in one call', async () => {
    const model = new TaskModel(serverDB, userId);
    const task = await model.create({ instruction: 'Imported', visibility: 'private' });
    const base = Date.parse('2026-01-01T00:00:00.000Z');
    const rows = Array.from({ length: 501 }, (_, index) => {
      const createdAt = new Date(base + index * 1000);
      return {
        authorUserId: userId,
        content: `Comment ${index}`,
        createdAt,
        updatedAt: createdAt,
        userId,
      };
    });

    const added = await model.addComments(task.id, rows);

    expect(added).toHaveLength(501);
    const stored = await model.getComments(task.id);
    expect(stored).toHaveLength(501);
    expect(stored[0]).toMatchObject({
      content: 'Comment 0',
      taskId: task.id,
      visibility: 'private',
    });
    expect(stored.at(-1)?.content).toBe('Comment 500');
  });

  it('stamps the workspace and adds nothing for no rows', async () => {
    await serverDB
      .insert(workspaces)
      .values({ id: workspaceId, name: 'WS', primaryOwnerId: userId, slug: workspaceId })
      .onConflictDoNothing();
    const model = new TaskModel(serverDB, userId, workspaceId);
    const task = await model.create({ instruction: 'Shared' });

    expect(await model.addComments(task.id, [])).toEqual([]);
    const [comment] = await model.addComments(task.id, [
      { authorUserId: userId, content: 'Hello', userId },
    ]);
    expect(comment).toMatchObject({ taskId: task.id, workspaceId });
  });

  it('refuses a task outside the caller scope', async () => {
    const task = await new TaskModel(serverDB, userId).create({ instruction: 'Mine' });

    await expect(
      new TaskModel(serverDB, otherUserId).addComments(task.id, [
        { authorUserId: otherUserId, content: 'Sneaky', userId: otherUserId },
      ]),
    ).rejects.toThrow('Task not found');
    expect(await new TaskModel(serverDB, userId).getComments(task.id)).toHaveLength(0);
  });
});
