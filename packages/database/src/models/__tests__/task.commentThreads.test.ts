// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { taskComments, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TaskModel } from '../task';

const db: LobeChatDatabase = await getTestDB();
const userId = 'task-thread-owner';
const otherUserId = 'task-thread-member';
const workspaceId = 'task-thread-workspace';

beforeEach(async () => {
  await db.delete(users);
  await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
});
afterEach(async () => {
  await db.delete(users);
});

const createWorkspace = async () => {
  await db.insert(workspaces).values({
    id: workspaceId,
    name: 'Threads',
    primaryOwnerId: userId,
    slug: workspaceId,
  });
};

describe('TaskModel comment threads', () => {
  it('persists root IDs, normalizes replies to replies, and preserves rich content', async () => {
    const model = new TaskModel(db, userId);
    const task = await model.create({ instruction: 'Thread' });
    const root = await model.addComment({ content: 'Root', taskId: task.id, userId });
    const editorData = { root: { children: [] } };
    const reply = await model.addComment({
      authorUserId: userId,
      content: 'Reply',
      editorData,
      parentCommentId: root.id,
      taskId: task.id,
      userId,
    });
    const next = await model.addComment({
      content: 'Reply to reply',
      parentCommentId: reply.id,
      taskId: task.id,
      userId,
    });

    const reloaded = await new TaskModel(db, userId).getComments(task.id);
    expect(reloaded).toHaveLength(3);
    expect(reloaded.find((c) => c.id === root.id)?.parentCommentId).toBeNull();
    expect(reloaded.find((c) => c.id === reply.id)).toMatchObject({
      authorUserId: userId,
      editorData,
      parentCommentId: root.id,
    });
    expect(reloaded.find((c) => c.id === next.id)?.parentCommentId).toBe(root.id);
    const updated = await model.updateComment(reply.id, 'Edited');
    expect(updated).toMatchObject({ content: 'Edited', editorData, parentCommentId: root.id });
  });

  it('rejects missing and cross-task parents without inserting comments', async () => {
    const model = new TaskModel(db, userId);
    const task = await model.create({ instruction: 'Target' });
    const other = await model.create({ instruction: 'Other' });
    const parent = await model.addComment({ content: 'Other root', taskId: other.id, userId });

    for (const parentCommentId of ['missing-parent', parent.id]) {
      await expect(
        model.addComment({ content: 'Rejected', parentCommentId, taskId: task.id, userId }),
      ).rejects.toThrow('Parent comment not found');
    }
    expect(await model.getComments(task.id)).toEqual([]);
  });

  it('rejects other-user and other-workspace parents while retaining the task write fence', async () => {
    const owner = new TaskModel(db, userId);
    const task = await owner.create({ instruction: 'Owner task' });
    const parent = await owner.addComment({ content: 'Private scope', taskId: task.id, userId });
    const outsider = new TaskModel(db, otherUserId);
    const ownTask = await outsider.create({ instruction: 'Outsider task' });
    await expect(
      outsider.addComment({
        content: 'No',
        parentCommentId: parent.id,
        taskId: ownTask.id,
        userId: otherUserId,
      }),
    ).rejects.toThrow('Parent comment not found');
    await expect(
      outsider.addComment({
        content: 'No',
        parentCommentId: parent.id,
        taskId: task.id,
        userId: otherUserId,
      }),
    ).rejects.toThrow('Task not found');

    await createWorkspace();
    const workspaceModel = new TaskModel(db, userId, workspaceId);
    const shared = await workspaceModel.create({ instruction: 'Workspace task' });
    await expect(
      workspaceModel.addComment({
        content: 'No',
        parentCommentId: parent.id,
        taskId: shared.id,
        userId,
      }),
    ).rejects.toThrow('Parent comment not found');
  });

  it('allows shared roots but rejects invisible parents and invisible resolved roots', async () => {
    await createWorkspace();
    const owner = new TaskModel(db, userId, workspaceId);
    const member = new TaskModel(db, otherUserId, workspaceId);
    const task = await owner.create({ instruction: 'Shared', visibility: 'public' });
    const root = await owner.addComment({ content: 'Root', taskId: task.id, userId });
    const reply = await member.addComment({
      content: 'Member reply',
      parentCommentId: root.id,
      taskId: task.id,
      userId: otherUserId,
    });
    expect(reply).toMatchObject({ parentCommentId: root.id, visibility: 'public', workspaceId });

    await db
      .update(taskComments)
      .set({ visibility: 'private' })
      .where(eq(taskComments.id, root.id));
    for (const parentCommentId of [root.id, reply.id]) {
      await expect(
        member.addComment({ content: 'No', parentCommentId, taskId: task.id, userId: otherUserId }),
      ).rejects.toThrow('Parent comment not found');
    }
    // Even a member's own old comment cannot bypass a now-private task.
    await owner.setSubtreeVisibility(task.id, [], 'private');
    await expect(
      member.addComment({
        content: 'No',
        parentCommentId: reply.id,
        taskId: task.id,
        userId: otherUserId,
      }),
    ).rejects.toThrow('Task not found');
    expect(await owner.getComments(task.id)).toHaveLength(2);
  });

  it('normalizes bulk reply targets and validates all parents before inserting any row', async () => {
    const model = new TaskModel(db, userId);
    const task = await model.create({ instruction: 'Bulk' });
    const root = await model.addComment({ content: 'Root', taskId: task.id, userId });
    const reply = await model.addComment({
      content: 'Reply',
      parentCommentId: root.id,
      taskId: task.id,
      userId,
    });
    const added = await model.addComments(task.id, [
      { content: 'Bulk root', userId },
      { content: 'Bulk reply', parentCommentId: reply.id, userId },
    ]);
    expect(added.map((c) => c.parentCommentId)).toEqual([null, root.id]);

    const invalid = Array.from({ length: 501 }, () => ({ content: 'No partial insert', userId }));
    await expect(
      model.addComments(task.id, [
        ...invalid,
        { content: 'Invalid', parentCommentId: 'missing-parent', userId },
      ]),
    ).rejects.toThrow('Parent comment not found');
    const other = await model.create({ instruction: 'Other' });
    await expect(
      model.addComments(other.id, [{ content: 'Cross-task', parentCommentId: reply.id, userId }]),
    ).rejects.toThrow('Parent comment not found');
    expect(await model.getComments(task.id)).toHaveLength(4);
    expect(await model.getComments(other.id)).toEqual([]);
  });

  it('applies the visibility fence to bulk parent normalization too', async () => {
    await createWorkspace();
    const owner = new TaskModel(db, userId, workspaceId);
    const task = await owner.create({ instruction: 'Shared' });
    const root = await owner.addComment({ content: 'Root', taskId: task.id, userId });
    await db
      .update(taskComments)
      .set({ visibility: 'private' })
      .where(eq(taskComments.id, root.id));
    await expect(
      new TaskModel(db, otherUserId, workspaceId).addComments(task.id, [
        { content: 'No', parentCommentId: root.id, userId: otherUserId },
      ]),
    ).rejects.toThrow('Parent comment not found');
    expect(await owner.getComments(task.id)).toHaveLength(1);
  });

  it('deletes just a reply, then cascades root deletion without touching other threads', async () => {
    const model = new TaskModel(db, userId);
    const task = await model.create({ instruction: 'Delete' });
    const root = await model.addComment({ content: 'Root', taskId: task.id, userId });
    const other = await model.addComment({ content: 'Other thread', taskId: task.id, userId });
    const first = await model.addComment({
      content: 'First',
      parentCommentId: root.id,
      taskId: task.id,
      userId,
    });
    const second = await model.addComment({
      content: 'Second',
      parentCommentId: first.id,
      taskId: task.id,
      userId,
    });
    expect(await new TaskModel(db, otherUserId).deleteComment(root.id)).toBe(false);
    expect(await model.deleteComment(first.id)).toBe(true);
    expect(await model.findCommentById(root.id)).toBeDefined();
    expect(await model.findCommentById(second.id)).toBeDefined();
    expect(await model.deleteComment(root.id)).toBe(true);
    expect(await model.findCommentById(second.id)).toBeUndefined();
    expect((await model.getComments(task.id)).map((c) => c.id)).toEqual([other.id]);
  });
});
