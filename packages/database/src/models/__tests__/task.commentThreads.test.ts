// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TaskModel } from '../task';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'task-comment-threads-user';
const otherUserId = 'task-comment-threads-other';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

const at = (seconds: number) => new Date(Date.parse('2026-01-01T00:00:00.000Z') + seconds * 1000);

describe('TaskModel comment threads', () => {
  it('reads one thread — the root and its replies, oldest first — and nothing else', async () => {
    const model = new TaskModel(serverDB, userId);
    const task = await model.create({ instruction: 'Threads' });
    const root = await model.addComment({
      content: 'Root',
      createdAt: at(0),
      taskId: task.id,
      userId,
    });
    const other = await model.addComment({
      content: 'Another thread',
      createdAt: at(1),
      taskId: task.id,
      userId,
    });
    await model.addComment({
      content: 'Second reply',
      createdAt: at(3),
      parentCommentId: root.id,
      taskId: task.id,
      userId,
    });
    await model.addComment({
      content: 'First reply',
      createdAt: at(2),
      parentCommentId: root.id,
      taskId: task.id,
      userId,
    });
    await model.addComment({
      content: 'Reply elsewhere',
      createdAt: at(4),
      parentCommentId: other.id,
      taskId: task.id,
      userId,
    });

    const thread = await model.getCommentThread(root.id);

    expect(thread.map((c) => c.content)).toEqual(['Root', 'First reply', 'Second reply']);
    expect(thread.slice(1).every((c) => c.parentCommentId === root.id)).toBe(true);
  });

  it('deletes the replies with their root, and a reply on its own', async () => {
    const model = new TaskModel(serverDB, userId);
    const task = await model.create({ instruction: 'Cascade' });
    const root = await model.addComment({ content: 'Root', taskId: task.id, userId });
    const reply = await model.addComment({
      content: 'Reply',
      parentCommentId: root.id,
      taskId: task.id,
      userId,
    });
    await model.addComment({
      content: 'Kept reply',
      parentCommentId: root.id,
      taskId: task.id,
      userId,
    });

    expect(await model.deleteComment(reply.id)).toBe(true);
    expect((await model.getCommentThread(root.id)).map((c) => c.content)).toEqual([
      'Root',
      'Kept reply',
    ]);

    expect(await model.deleteComment(root.id)).toBe(true);
    expect(await model.getComments(task.id)).toEqual([]);
  });

  it('does not show a thread to a caller outside the task scope', async () => {
    const model = new TaskModel(serverDB, userId);
    const task = await model.create({ instruction: 'Private', visibility: 'private' });
    const root = await model.addComment({ content: 'Root', taskId: task.id, userId });

    expect(await new TaskModel(serverDB, otherUserId).getCommentThread(root.id)).toEqual([]);
  });
});
