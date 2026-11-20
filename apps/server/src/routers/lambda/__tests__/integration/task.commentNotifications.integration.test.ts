// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { taskRouter } from '../../task';
import { cleanupTestUser, createTestContext, createTestUser } from './setup';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return testDB;
  }),
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
}));

vi.mock('@/business/server/task/notifyTaskAssigned', () => ({
  notifyTaskAssigned: vi.fn().mockResolvedValue(undefined),
}));

// Mock the comment-notification business slot (default impl is a no-op).
const mockNotifyTaskCommentActivity = vi.fn().mockResolvedValue(undefined);
vi.mock('@/business/server/task/notifyTaskCommentActivity', () => ({
  notifyTaskCommentActivity: (...args: unknown[]) => mockNotifyTaskCommentActivity(...args),
}));

// Notifications are retained past the response through `after()`; run that
// work eagerly here and flush it before asserting on the slot above.
const afterResponseTasks = vi.hoisted(() => [] as Promise<unknown>[]);
vi.mock('@/server/utils/scheduleAfterResponse', () => ({
  after: (work: () => unknown) => void afterResponseTasks.push(Promise.resolve().then(work)),
}));
const flushAfterResponse = async () => {
  while (afterResponseTasks.length > 0) await Promise.all(afterResponseTasks.splice(0));
};

describe('Task Router comment notifications', () => {
  let serverDB: LobeChatDatabase;
  let userId: string;
  let otherUserId: string | undefined;
  let caller: ReturnType<typeof taskRouter.createCaller>;

  beforeEach(async () => {
    vi.clearAllMocks();
    serverDB = await getTestDB();
    testDB = serverDB;
    userId = await createTestUser(serverDB);
    caller = taskRouter.createCaller(createTestContext(userId));
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, userId);
    if (otherUserId) await cleanupTestUser(serverDB, otherUserId);
    otherUserId = undefined;
  });

  const mentionNode = (userId: string) => ({
    label: 'Member',
    metadata: { id: userId, type: 'member' },
    type: 'mention',
  });
  const editorDataWith = (...userIds: string[]) => ({
    root: { children: [{ children: userIds.map(mentionNode), type: 'paragraph' }] },
  });

  const setupWorkspace = async () => {
    const workspaceId = 'task-comment-notify-workspace';
    const { workspaces, workspaceMembers } = await import('@/database/schemas');
    await serverDB.insert(workspaces).values({
      id: workspaceId,
      name: 'Task Comment Notify Workspace',
      primaryOwnerId: userId,
      slug: workspaceId,
    });
    await serverDB.insert(workspaceMembers).values([
      { role: 'owner', userId, workspaceId },
      { role: 'member', userId: otherUserId!, workspaceId },
    ]);
    return {
      wsCaller: taskRouter.createCaller({ ...createTestContext(userId), workspaceId }),
      wsOtherCaller: taskRouter.createCaller({
        ...createTestContext(otherUserId!),
        workspaceId,
      }),
      workspaceId,
    };
  };

  it('should ping the task creator and @mentioned members on a new member comment', async () => {
    otherUserId = await createTestUser(serverDB);
    const { wsCaller, wsOtherCaller, workspaceId } = await setupWorkspace();
    const task = await wsCaller.create({ instruction: 'Discuss', name: 'Discuss' });

    // The creator commenting on their own task with no mentions pings nobody.
    await wsCaller.addComment({ content: 'note to self', id: task.data.id });
    await flushAfterResponse();
    expect(mockNotifyTaskCommentActivity).not.toHaveBeenCalled();

    // Another member commenting pings the creator as ambient activity.
    const comment = await wsOtherCaller.addComment({ content: 'hello', id: task.data.id });
    await flushAfterResponse();
    expect(mockNotifyTaskCommentActivity).toHaveBeenCalledTimes(1);
    expect(mockNotifyTaskCommentActivity).toHaveBeenCalledWith({
      actorUserId: otherUserId,
      commentId: comment.data.id,
      recipients: [{ kind: 'commented', userId }],
      taskId: task.data.id,
      workspaceId,
    });

    // The creator @mentioning the other member pings them as mentioned;
    // unknown ids and self-mentions are dropped.
    const mentioned = await wsCaller.addComment({
      content: '@Member look',
      editorData: editorDataWith(otherUserId!, userId, 'not-a-member'),
      id: task.data.id,
    });
    await flushAfterResponse();
    expect(mockNotifyTaskCommentActivity).toHaveBeenLastCalledWith({
      actorUserId: userId,
      commentId: mentioned.data.id,
      recipients: [{ kind: 'mentioned', userId: otherUserId }],
      taskId: task.data.id,
      workspaceId,
    });
  });

  it('should upgrade the assignee to mentioned; agent notes ping only their @mentions', async () => {
    otherUserId = await createTestUser(serverDB);
    const { wsCaller, workspaceId } = await setupWorkspace();
    const task = await wsCaller.create({
      assigneeUserId: otherUserId,
      instruction: 'Assigned',
    });
    await flushAfterResponse();
    mockNotifyTaskCommentActivity.mockClear();

    await wsCaller.addComment({ content: 'ping', id: task.data.id });
    await flushAfterResponse();
    expect(mockNotifyTaskCommentActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({
        recipients: [{ kind: 'commented', userId: otherUserId }],
        workspaceId,
      }),
    );

    await wsCaller.addComment({
      content: '@Member',
      editorData: editorDataWith(otherUserId!),
      id: task.data.id,
    });
    await flushAfterResponse();
    expect(mockNotifyTaskCommentActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({ recipients: [{ kind: 'mentioned', userId: otherUserId }] }),
    );

    const { agents } = await import('@/database/schemas');
    const wsAgentId = 'agt_task_comment_ws';
    await serverDB
      .insert(agents)
      .values({ id: wsAgentId, slug: wsAgentId, userId, workspaceId })
      .onConflictDoNothing();
    mockNotifyTaskCommentActivity.mockClear();
    const agentNote = async (content: string) => {
      await wsCaller.addComment({ authorAgentId: wsAgentId, content, id: task.data.id });
      await flushAfterResponse();
    };
    await agentNote('Agent progress note');
    expect(mockNotifyTaskCommentActivity).not.toHaveBeenCalled();
    await agentNote(`Done <mention name="M" id="${otherUserId}" />`);
    expect(mockNotifyTaskCommentActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        actorAgentId: wsAgentId,
        recipients: [{ kind: 'mentioned', userId: otherUserId }],
      }),
    );

    // The agent wrote it, so the member it runs for can be @mentioned too;
    // a tag quoted inside a code span is not a mention.
    mockNotifyTaskCommentActivity.mockClear();
    await agentNote(
      `Review please <mention name="Owner" id="${userId}" />, syntax: \`<mention id="${otherUserId}" />\``,
    );
    expect(mockNotifyTaskCommentActivity).toHaveBeenCalledTimes(1);
    expect(mockNotifyTaskCommentActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        actorAgentId: wsAgentId,
        actorUserId: userId,
        recipients: [{ kind: 'mentioned', userId }],
      }),
    );

    // Editing the agent note to add a markdown mention pings only the new one,
    // attributed to the member who made the edit.
    const note = await wsCaller.addComment({
      authorAgentId: wsAgentId,
      content: 'Status update',
      id: task.data.id,
    });
    await flushAfterResponse();
    mockNotifyTaskCommentActivity.mockClear();
    await wsCaller.updateComment({
      commentId: note.data.id,
      content: `Status update <mention name="M" id="${otherUserId}" />`,
    });
    await flushAfterResponse();
    expect(mockNotifyTaskCommentActivity).toHaveBeenCalledWith({
      actorUserId: userId,
      commentId: note.data.id,
      recipients: [{ kind: 'mentioned', userId: otherUserId }],
      taskId: task.data.id,
      workspaceId,
    });
    expect(mockNotifyTaskCommentActivity.mock.lastCall?.[0]).not.toHaveProperty('actorAgentId');
  });

  it('should only ping newly added mentions when a comment is edited', async () => {
    otherUserId = await createTestUser(serverDB);
    const thirdUserId = await createTestUser(serverDB);
    const { wsCaller, workspaceId } = await setupWorkspace();
    const { workspaceMembers } = await import('@/database/schemas');
    await serverDB
      .insert(workspaceMembers)
      .values({ role: 'member', userId: thirdUserId, workspaceId });
    const task = await wsCaller.create({ instruction: 'Edit mentions' });
    const comment = await wsCaller.addComment({
      content: '@Member',
      editorData: editorDataWith(otherUserId!),
      id: task.data.id,
    });
    await flushAfterResponse();
    mockNotifyTaskCommentActivity.mockClear();

    // Keeping the same mention does not re-notify.
    await wsCaller.updateComment({
      commentId: comment.data.id,
      content: '@Member edited',
      editorData: editorDataWith(otherUserId!),
    });
    await flushAfterResponse();
    expect(mockNotifyTaskCommentActivity).not.toHaveBeenCalled();

    // Adding a new mention pings only the new member.
    await wsCaller.updateComment({
      commentId: comment.data.id,
      content: '@Member @Third',
      editorData: editorDataWith(otherUserId!, thirdUserId),
    });
    await flushAfterResponse();
    expect(mockNotifyTaskCommentActivity).toHaveBeenCalledTimes(1);
    expect(mockNotifyTaskCommentActivity).toHaveBeenCalledWith({
      actorUserId: userId,
      commentId: comment.data.id,
      recipients: [{ kind: 'mentioned', userId: thirdUserId }],
      taskId: task.data.id,
      workspaceId,
    });

    // A content-only edit without new mention tags does not notify.
    await wsCaller.updateComment({ commentId: comment.data.id, content: 'plain' });
    await flushAfterResponse();
    expect(mockNotifyTaskCommentActivity).toHaveBeenCalledTimes(1);
  });

  it('should never notify members who cannot open a private task', async () => {
    otherUserId = await createTestUser(serverDB);
    const thirdUserId = await createTestUser(serverDB);
    const { wsCaller, workspaceId } = await setupWorkspace();
    const { workspaceMembers } = await import('@/database/schemas');
    await serverDB
      .insert(workspaceMembers)
      .values({ role: 'member', userId: thirdUserId, workspaceId });
    // A private task is visible to its creator only (assigning it to another
    // member is rejected upstream), yet the creator can still @mention anyone.
    const task = await wsCaller.create({
      instruction: 'Secret',
      name: 'Secret',
      visibility: 'private',
    });

    // The mention must not leak the task's title and link to a member who
    // cannot open it — neither on a new comment nor on an edit.
    const comment = await wsCaller.addComment({
      content: '@Member',
      editorData: editorDataWith(otherUserId!),
      id: task.data.id,
    });
    await flushAfterResponse();
    expect(mockNotifyTaskCommentActivity).not.toHaveBeenCalled();

    await wsCaller.updateComment({
      commentId: comment.data.id,
      content: '@Member @Third',
      editorData: editorDataWith(otherUserId!, thirdUserId),
    });
    await flushAfterResponse();
    expect(mockNotifyTaskCommentActivity).not.toHaveBeenCalled();
  });

  it('should never notify in personal mode', async () => {
    const task = await caller.create({ instruction: 'Personal' });
    await caller.addComment({
      content: '@someone',
      editorData: editorDataWith('someone'),
      id: task.data.id,
    });
    await flushAfterResponse();
    expect(mockNotifyTaskCommentActivity).not.toHaveBeenCalled();
  });
});
