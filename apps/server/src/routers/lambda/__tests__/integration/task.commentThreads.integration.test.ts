// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { TRPCError } from '@trpc/server';
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

const mockNotifyTaskCommentActivity = vi.fn().mockResolvedValue(undefined);
vi.mock('@/business/server/task/notifyTaskCommentActivity', () => ({
  notifyTaskCommentActivity: (...args: unknown[]) => mockNotifyTaskCommentActivity(...args),
}));

const afterResponseTasks = vi.hoisted(() => [] as Promise<unknown>[]);
vi.mock('@/server/utils/scheduleAfterResponse', () => ({
  after: (work: () => unknown) => void afterResponseTasks.push(Promise.resolve().then(work)),
}));
const flushAfterResponse = async () => {
  while (afterResponseTasks.length > 0) await Promise.all(afterResponseTasks.splice(0));
};

// The wake starts a real agent run; the runner's own behavior is covered by
// its tests, so here only what the comment asks of it is checked.
const mockRunTask = vi.hoisted(() => vi.fn());
vi.mock('@/server/services/taskRunner', () => ({
  TaskRunnerService: vi.fn(function () {
    return { runTask: mockRunTask };
  }),
}));

describe('Task Router comment threads', () => {
  let serverDB: LobeChatDatabase;
  let userId: string;
  let otherUserId: string | undefined;
  const workspaceId = 'task-comment-threads-workspace';

  beforeEach(async () => {
    vi.clearAllMocks();
    mockRunTask.mockResolvedValue({ success: true, topicId: 'tpc_woken' });
    serverDB = await getTestDB();
    testDB = serverDB;
    userId = await createTestUser(serverDB);
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, userId);
    if (otherUserId) await cleanupTestUser(serverDB, otherUserId);
    otherUserId = undefined;
  });

  const setupWorkspace = async () => {
    otherUserId = await createTestUser(serverDB);
    const { workspaces, workspaceMembers } = await import('@/database/schemas');
    await serverDB.insert(workspaces).values({
      id: workspaceId,
      name: 'Task Comment Threads',
      primaryOwnerId: userId,
      slug: workspaceId,
    });
    await serverDB.insert(workspaceMembers).values([
      { role: 'owner', userId, workspaceId },
      { role: 'member', userId: otherUserId, workspaceId },
    ]);
    return {
      wsCaller: taskRouter.createCaller({ ...createTestContext(userId), workspaceId }),
      wsOtherCaller: taskRouter.createCaller({ ...createTestContext(otherUserId), workspaceId }),
    };
  };

  const insertAgent = async (id: string, visibility: 'private' | 'public' = 'public') => {
    const { agents } = await import('@/database/schemas');
    await serverDB
      .insert(agents)
      .values({ id, slug: id, title: id, userId, visibility, workspaceId })
      .onConflictDoNothing();
  };

  const agentMention = (id: string) => ({
    label: id,
    metadata: { id, type: 'agent' },
    type: 'mention',
  });
  const editorDataWithAgents = (...ids: string[]) => ({
    root: {
      children: [
        { children: [{ text: 'please look ' }, ...ids.map(agentMention)], type: 'paragraph' },
      ],
    },
  });

  it('files a reply under its root, and a reply to a reply under the same root', async () => {
    const { wsCaller } = await setupWorkspace();
    const task = await wsCaller.create({ instruction: 'Threads' });
    const root = await wsCaller.addComment({ content: 'Root', id: task.data.id });

    const reply = await wsCaller.addComment({
      content: 'Reply',
      id: task.data.id,
      parentCommentId: root.data.id,
    });
    const nested = await wsCaller.addComment({
      content: 'Reply to the reply',
      id: task.data.id,
      parentCommentId: reply.data.id,
    });

    expect(reply.data.parentCommentId).toBe(root.data.id);
    expect(nested.data.parentCommentId).toBe(root.data.id);

    const detail = await wsCaller.detail({ id: task.data.id });
    const comments = detail.data.activities?.filter((a) => a.type === 'comment') ?? [];
    expect(comments.map((c) => [c.content, c.parentCommentId])).toEqual([
      ['Root', null],
      ['Reply', root.data.id],
      ['Reply to the reply', root.data.id],
    ]);
  });

  it('refuses a parent comment from another task', async () => {
    const { wsCaller } = await setupWorkspace();
    const first = await wsCaller.create({ instruction: 'First' });
    const second = await wsCaller.create({ instruction: 'Second' });
    const elsewhere = await wsCaller.addComment({ content: 'Elsewhere', id: first.data.id });

    await expect(
      wsCaller.addComment({
        content: 'Wrong thread',
        id: second.data.id,
        parentCommentId: elsewhere.data.id,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('pings the members already in the thread when a reply lands', async () => {
    const { wsCaller, wsOtherCaller } = await setupWorkspace();
    const task = await wsCaller.create({ instruction: 'Discuss' });
    const root = await wsOtherCaller.addComment({ content: 'Question', id: task.data.id });
    await flushAfterResponse();
    mockNotifyTaskCommentActivity.mockClear();

    // The creator replies: the member who opened the thread hears about it.
    await wsCaller.addComment({
      content: 'Answer',
      id: task.data.id,
      parentCommentId: root.data.id,
    });
    await flushAfterResponse();

    expect(mockNotifyTaskCommentActivity).toHaveBeenCalledWith(
      expect.objectContaining({ recipients: [{ kind: 'commented', userId: otherUserId }] }),
    );
  });

  it('wakes the first @mentioned agent to answer in the thread, and skips the rest', async () => {
    const { wsCaller } = await setupWorkspace();
    await insertAgent('agt_thread_first');
    await insertAgent('agt_thread_second');
    const task = await wsCaller.create({ instruction: 'Wake' });
    const root = await wsCaller.addComment({ content: 'Root question', id: task.data.id });

    const reply = await wsCaller.addComment({
      content: 'please look <mention name="First" id="agt_thread_first" />',
      editorData: editorDataWithAgents('agt_thread_first', 'agt_thread_second'),
      id: task.data.id,
      parentCommentId: root.data.id,
    });

    expect(reply.wakes).toEqual([
      { agentId: 'agt_thread_first', status: 'started', topicId: 'tpc_woken' },
      { agentId: 'agt_thread_second', status: 'skipped' },
    ]);
    expect(mockRunTask).toHaveBeenCalledTimes(1);
    const [params] = mockRunTask.mock.calls[0];
    expect(params).toMatchObject({
      agentId: 'agt_thread_first',
      replyToCommentId: root.data.id,
      taskId: task.data.id,
      title: 'please look @First',
    });
    // The agent sees the whole thread and which comment asked it.
    expect(params.extraPrompt).toContain('Root question');
    expect(params.extraPrompt).toContain(`id="${reply.data.id}"`);
    expect(params.extraPrompt).toContain('mentioned_you="true"');
  });

  it('reports busy when the task already has a run, and does not wake from agent notes', async () => {
    const { wsCaller } = await setupWorkspace();
    await insertAgent('agt_thread_busy');
    const task = await wsCaller.create({ instruction: 'Busy' });
    mockRunTask.mockRejectedValueOnce(new TRPCError({ code: 'CONFLICT', message: 'running' }));

    const busy = await wsCaller.addComment({
      content: 'ping <mention name="Busy" id="agt_thread_busy" />',
      id: task.data.id,
    });
    expect(busy.wakes).toEqual([{ agentId: 'agt_thread_busy', status: 'busy' }]);

    mockRunTask.mockClear();
    const agentNote = await wsCaller.addComment({
      authorAgentId: 'agt_thread_busy',
      content: 'self ping <mention name="Busy" id="agt_thread_busy" />',
      id: task.data.id,
    });
    expect(agentNote.wakes).toEqual([]);
    expect(mockRunTask).not.toHaveBeenCalled();
  });

  it('does not wake a private agent on a public task', async () => {
    const { wsCaller } = await setupWorkspace();
    await insertAgent('agt_thread_private', 'private');
    const task = await wsCaller.create({ instruction: 'Public' });

    const result = await wsCaller.addComment({
      content: 'ping <mention name="Private" id="agt_thread_private" />',
      id: task.data.id,
    });

    expect(result.wakes).toEqual([{ agentId: 'agt_thread_private', status: 'unavailable' }]);
    expect(mockRunTask).not.toHaveBeenCalled();
  });
});
