// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { workspaceMembers, workspaces } from '@/database/schemas';

import { taskRouter } from '../../task';
import { cleanupTestUser, createTestContext, createTestUser } from './setup';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(() => testDB) }));
vi.mock('@/server/modules/ModelRuntime', () => ({ initModelRuntimeFromDB: vi.fn() }));
vi.mock('@/business/server/task/notifyTaskAssigned', () => ({
  notifyTaskAssigned: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/business/server/task/notifyTaskCommentActivity', () => ({
  notifyTaskCommentActivity: vi.fn().mockResolvedValue(undefined),
}));
const afterResponseTasks = vi.hoisted(() => [] as Promise<unknown>[]);
vi.mock('@/server/utils/scheduleAfterResponse', () => ({
  after: (work: () => unknown) => void afterResponseTasks.push(Promise.resolve().then(work)),
}));

// These exercise the real router, comment model and detail serialization together.
describe('Task Router comment threads', () => {
  let userId: string;
  let otherUserId: string;
  let caller: ReturnType<typeof taskRouter.createCaller>;

  beforeEach(async () => {
    vi.clearAllMocks();
    testDB = await getTestDB();
    userId = await createTestUser(testDB);
    otherUserId = await createTestUser(testDB);
    caller = taskRouter.createCaller(createTestContext(userId));
  });
  afterEach(async () => {
    while (afterResponseTasks.length > 0) await Promise.all(afterResponseTasks.splice(0));
    await cleanupTestUser(testDB, userId);
    await cleanupTestUser(testDB, otherUserId);
  });

  it('returns persisted root pointers in addComment and flat detail activities', async () => {
    const task = await caller.create({ instruction: 'Thread' });
    const root = await caller.addComment({ content: 'Root', id: task.data.id });
    const reply = await caller.addComment({
      content: 'Reply',
      id: task.data.id,
      parentCommentId: root.data.id,
    });
    const next = await caller.addComment({
      content: 'Reply to reply',
      id: task.data.id,
      parentCommentId: reply.data.id,
    });
    expect(root.data.parentCommentId).toBeNull();
    expect(reply.data.parentCommentId).toBe(root.data.id);
    expect(next.data.parentCommentId).toBe(root.data.id);

    const reloaded = await taskRouter
      .createCaller(createTestContext(userId))
      .detail({ id: task.data.id });
    const comments = reloaded.data.activities?.filter((a) => a.type === 'comment');
    expect(comments).toHaveLength(3);
    expect(comments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: root.data.id, parentCommentId: null }),
        expect.objectContaining({ id: reply.data.id, parentCommentId: root.data.id }),
        expect.objectContaining({ id: next.data.id, parentCommentId: root.data.id }),
      ]),
    );
    for (const activity of reloaded.data.activities?.filter((a) => a.type !== 'comment') ?? []) {
      expect(activity).not.toHaveProperty('parentCommentId');
    }

    await caller.deleteComment({ commentId: root.data.id });
    const deleted = await caller.detail({ id: task.data.id });
    expect(deleted.data.activities?.filter((a) => a.type === 'comment')).toEqual([]);
  });

  it('rejects missing and cross-task parents with NOT_FOUND rather than inserting roots', async () => {
    const task = await caller.create({ instruction: 'Target' });
    const other = await caller.create({ instruction: 'Other' });
    const parent = await caller.addComment({ content: 'Other root', id: other.data.id });
    for (const parentCommentId of ['missing-parent', parent.data.id]) {
      await expect(
        caller.addComment({ content: 'No', id: task.data.id, parentCommentId }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Parent comment not found' });
    }
    const detail = await caller.detail({ id: task.data.id });
    expect(detail.data.activities?.filter((a) => a.type === 'comment')).toEqual([]);
  });

  it("rejects another user's comment ID without disclosing its task", async () => {
    const other = taskRouter.createCaller(createTestContext(otherUserId));
    const foreignTask = await other.create({ instruction: 'Private scope' });
    const parent = await other.addComment({ content: 'Private', id: foreignTask.data.id });
    const task = await caller.create({ instruction: 'Mine' });
    await expect(
      caller.addComment({
        content: 'No',
        id: task.data.id,
        parentCommentId: parent.data.id,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Parent comment not found' });
  });

  it('rejects a private workspace task parent from a shared task', async () => {
    const workspaceId = `thread-ws-${userId}`;
    await testDB.insert(workspaces).values({
      id: workspaceId,
      name: 'Threads',
      primaryOwnerId: userId,
      slug: workspaceId,
    });
    await testDB.insert(workspaceMembers).values([
      { role: 'owner', userId, workspaceId },
      { role: 'member', userId: otherUserId, workspaceId },
    ]);
    const owner = taskRouter.createCaller({ ...createTestContext(userId), workspaceId });
    const member = taskRouter.createCaller({ ...createTestContext(otherUserId), workspaceId });
    const privateTask = await owner.create({ instruction: 'Private', visibility: 'private' });
    const parent = await owner.addComment({ content: 'Hidden', id: privateTask.data.id });
    const sharedTask = await member.create({ instruction: 'Shared' });
    await expect(
      member.addComment({
        content: 'No',
        id: sharedTask.data.id,
        parentCommentId: parent.data.id,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Parent comment not found' });
    const detail = await member.detail({ id: sharedTask.data.id });
    expect(detail.data.activities?.filter((a) => a.type === 'comment')).toEqual([]);
  });
});
