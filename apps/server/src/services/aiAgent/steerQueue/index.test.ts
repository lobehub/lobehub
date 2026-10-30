import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mergeQueuedFollowUps, type QueuedFollowUp, startQueuedFollowUp } from './index';

const {
  assertCanUseAgentRunConversation,
  assertCanUseWorkspaceAgent,
  drain,
  restore,
  startComposerRun,
} = vi.hoisted(() => ({
  assertCanUseAgentRunConversation: vi.fn(),
  assertCanUseWorkspaceAgent: vi.fn(),
  drain: vi.fn(),
  restore: vi.fn(),
  startComposerRun: vi.fn(),
}));

const { boundOperations, findOwnLiveRuns, isRunAlive, settle } = vi.hoisted(() => ({
  boundOperations: vi.fn(),
  settle: vi.fn(),
  findOwnLiveRuns: vi.fn(),
  isRunAlive: vi.fn(),
}));
vi.mock('@/server/services/redis', () => ({
  redisService: { steerQueue: { boundOperations, drain, restore, settle } },
}));
vi.mock('./liveRuns', () => ({ findOwnLiveRuns, isRunAlive }));
vi.mock('../composerRun', () => ({ startComposerRun }));
vi.mock('@/server/routers/lambda/_helpers/workspaceAgentGuard', () => ({
  assertCanUseWorkspaceAgent,
}));
vi.mock('@/server/routers/lambda/aiAgent/guards', () => ({
  assertCanUseAgentRunConversation,
}));

const followUp = (id: string, createdAt: number, request: Partial<QueuedFollowUp['request']>) =>
  ({
    audit: { clientIp: `ip-${id}` },
    createdAt,
    id,
    request: { agentId: 'agt-1', appContext: { topicId: 'tpc-1' }, prompt: id, ...request },
    userId: 'user-1',
  }) as QueuedFollowUp;

const ctx = { aiAgentService: {} as any, db: {} as any, userId: 'user-1', workspaceId: 'ws-1' };
const finished = (scope: { threadId?: string | null; topicId: string }) => ({
  operationId: 'op-1',
  scope: { threadId: null, userId: 'user-1', ...scope },
});

describe('mergeQueuedFollowUps', () => {
  it('joins the texts in queue order and keeps every attachment and selection', () => {
    const merged = mergeQueuedFollowUps([
      followUp('second', 2, { fileIds: ['f2'], selectedSkillIds: ['s1'] }),
      followUp('first', 1, {
        fileIds: ['f1'],
        mentionedAgents: [{ id: 'a1', name: 'A' }],
        selectedSkillIds: ['s1'],
      }),
    ]);

    expect(merged.prompt).toBe('first\n\nsecond');
    expect(merged.fileIds).toEqual(['f1', 'f2']);
    expect(merged.selectedSkillIds).toEqual(['s1']);
    expect(merged.mentionedAgents).toEqual([{ id: 'a1', name: 'A' }]);
  });

  it('keeps every follow-up’s attached content in queue order, and rich text only when sent alone', () => {
    const quote = (id: string) => ({ content: id, id, source: 'text' as const });
    const page = { content: 'p2', id: 'p2', pageId: 'page-1' };
    const doc = (text: string) => ({ root: { children: [{ text }], type: 'root' } });
    const merged = mergeQueuedFollowUps([
      followUp('second', 2, {
        userMessage: {
          editorData: doc('second'),
          metadata: { contextSelections: [quote('q2')], pageSelections: [page] },
        },
      }),
      followUp('first', 1, { userMessage: { metadata: { contextSelections: [quote('q1')] } } }),
      followUp('third', 3, {}),
    ]);

    expect(merged.userMessage).toEqual({
      metadata: { contextSelections: [quote('q1'), quote('q2')], pageSelections: [page] },
    });
    expect(mergeQueuedFollowUps([followUp('only', 1, {})]).userMessage).toBeUndefined();
    expect(
      mergeQueuedFollowUps([followUp('only', 1, { userMessage: { editorData: doc('only') } })])
        .userMessage,
    ).toEqual({ editorData: doc('only') });
  });

  it('names the MCP App view only when every merged follow-up came from it', () => {
    const fromView = (id: string, createdAt: number, identifier: string) =>
      followUp(id, createdAt, { userMessage: { metadata: { mcpAppSource: { identifier } } } });

    expect(
      mergeQueuedFollowUps([fromView('a', 1, 'weather'), fromView('b', 2, 'weather')]).userMessage,
    ).toEqual({ metadata: { mcpAppSource: { identifier: 'weather' } } });
    expect(
      mergeQueuedFollowUps([fromView('a', 1, 'weather'), followUp('b', 2, {})]).userMessage,
    ).toBeUndefined();
    expect(
      mergeQueuedFollowUps([fromView('a', 1, 'weather'), fromView('b', 2, 'maps')]).userMessage,
    ).toBeUndefined();
  });

  it('runs with the newest settings and drops per-send client ids once merged', () => {
    const merged = mergeQueuedFollowUps([
      followUp('a', 1, { clientIds: { userMessageId: 'u-a' } as any, deviceId: 'old' }),
      followUp('b', 2, { clientIds: { userMessageId: 'u-b' } as any, deviceId: 'new' }),
    ]);

    expect(merged.deviceId).toBe('new');
    expect(merged.clientIds).toBeUndefined();
    expect(
      mergeQueuedFollowUps([followUp('a', 1, { clientIds: { x: 1 } as any })]).clientIds,
    ).toEqual({ x: 1 });
  });
});

describe('startQueuedFollowUp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    drain.mockResolvedValue([]);
    restore.mockResolvedValue(undefined);
    settle.mockResolvedValue(undefined);
    boundOperations.mockResolvedValue({ operationIds: ['op-1', 'op-ended', 'op-live'], total: 3 });
    findOwnLiveRuns.mockResolvedValue(['op-1']);
    isRunAlive.mockImplementation(
      async (_ctx: unknown, _user: string, id: string) => id !== 'op-ended',
    );
    assertCanUseWorkspaceAgent.mockResolvedValue(undefined);
    assertCanUseAgentRunConversation.mockResolvedValue(undefined);
    startComposerRun.mockResolvedValue({ operationId: 'op-2' });
  });

  it('starts the drained follow-ups as their own turn on the same surface', async () => {
    drain.mockResolvedValue([followUp('a', 1, {}), followUp('b', 2, {})]);

    await expect(
      startQueuedFollowUp(ctx, finished({ threadId: 'thd-1', topicId: 'tpc-1' })),
    ).resolves.toEqual({ operationId: 'op-2' });

    expect(drain).toHaveBeenCalledWith(
      { threadId: 'thd-1', topicId: 'tpc-1', userId: 'user-1' },
      'op-1',
      // Only the run confirmed ended; the live one and the finishing run itself are not orphans.
      ['op-ended'],
      expect.any(String),
    );
    expect(isRunAlive).not.toHaveBeenCalledWith(expect.anything(), 'user-1', 'op-1');
    expect(startComposerRun).toHaveBeenCalledWith(
      expect.objectContaining({ clientIp: 'ip-b', supersedeLiveRun: false, userId: 'user-1' }),
      expect.objectContaining({
        appContext: { threadId: 'thd-1', topicId: 'tpc-1' },
        prompt: 'a\n\nb',
        queuedSuccessor: true,
      }),
    );
    // A drained follow-up opens a turn of its own; only a steer of the run it
    // waited behind would mark the user message.
    expect(startComposerRun.mock.calls[0][1].steer).toBeUndefined();
    // Delivered: the slots the drain reserved are free again.
    expect(settle).toHaveBeenCalledWith(
      expect.objectContaining({ topicId: 'tpc-1' }),
      expect.any(String),
    );
  });

  it('reads a follow-up queued in the old shape (top-level selections) as attached content', async () => {
    const quote = { content: 'Quoted reply', id: 'selection-1', source: 'text' as const };
    const page = { content: 'Selected paragraph', id: 'page-1', pageId: 'page-1' };
    // Stored by a client from before `userMessage`; it survives in Redis across a deploy.
    drain.mockResolvedValue([
      followUp('legacy', 1, { contextSelections: [quote], pageSelections: [page] } as any),
    ]);

    await startQueuedFollowUp(ctx, finished({ topicId: 'tpc-1' }));

    const request = startComposerRun.mock.calls[0][1];
    expect(request.userMessage).toEqual({
      metadata: { contextSelections: [quote], pageSelections: [page] },
    });
    expect(request).not.toHaveProperty('contextSelections');
    expect(request).not.toHaveProperty('pageSelections');
  });

  it('puts the follow-ups back when the next turn cannot start', async () => {
    const entries = [followUp('a', 1, {})];
    drain.mockResolvedValue(entries);
    startComposerRun.mockRejectedValue(new Error('topic busy'));

    await expect(startQueuedFollowUp(ctx, finished({ topicId: 'tpc-1' }))).resolves.toBeUndefined();

    expect(settle).toHaveBeenCalledWith(
      { threadId: null, topicId: 'tpc-1', userId: 'user-1' },
      expect.any(String),
      entries.map((e) => e.id),
    );
  });

  it('never starts a follow-up someone else queued under the run owner', async () => {
    drain.mockResolvedValue([{ ...followUp('a', 1, {}), userId: 'intruder' }]);

    await startQueuedFollowUp(ctx, finished({ topicId: 'tpc-1' }));

    expect(startComposerRun).not.toHaveBeenCalled();
  });

  it('re-checks access before the queued turn starts, and drops it when access was revoked', async () => {
    drain.mockResolvedValue([
      followUp('a', 1, { appContext: { groupId: 'grp-1', topicId: 'tpc-1' } }),
    ]);
    assertCanUseWorkspaceAgent.mockRejectedValue(new TRPCError({ code: 'FORBIDDEN' }));

    await expect(startQueuedFollowUp(ctx, finished({ topicId: 'tpc-1' }))).resolves.toBeUndefined();

    expect(assertCanUseWorkspaceAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agt-1',
        groupId: 'grp-1',
        userId: 'user-1',
        workspaceId: 'ws-1',
      }),
    );
    expect(startComposerRun).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('keeps the follow-ups when the access check itself fails', async () => {
    const entries = [followUp('a', 1, {})];
    drain.mockResolvedValue(entries);
    assertCanUseAgentRunConversation.mockRejectedValue(new Error('connection reset'));

    await startQueuedFollowUp(ctx, finished({ topicId: 'tpc-1' }));

    expect(startComposerRun).not.toHaveBeenCalled();
    expect(settle).toHaveBeenCalledWith(
      { threadId: null, topicId: 'tpc-1', userId: 'user-1' },
      expect.any(String),
      entries.map((e) => e.id),
    );
  });

  it('skips the live-run lookup when nothing is queued', async () => {
    boundOperations.mockResolvedValue({ operationIds: [], total: 0 });

    await expect(startQueuedFollowUp(ctx, finished({ topicId: 'tpc-1' }))).resolves.toBeUndefined();

    expect(isRunAlive).not.toHaveBeenCalled();
    expect(drain).not.toHaveBeenCalled();
  });

  it('never interrupts a run the user started while the topic was free; leaves the follow-ups to it', async () => {
    const entries = [followUp('a', 1, {})];
    drain.mockResolvedValue(entries);
    findOwnLiveRuns.mockResolvedValue(['op-1', 'op-newer']);

    await expect(startQueuedFollowUp(ctx, finished({ topicId: 'tpc-1' }))).resolves.toBeUndefined();

    expect(startComposerRun).not.toHaveBeenCalled();
    expect(settle).toHaveBeenCalledWith(
      { threadId: null, topicId: 'tpc-1', userId: 'user-1' },
      expect.any(String),
      entries.map((e) => e.id),
    );
  });

  it('reads a drain back once with the same id when its response was lost', async () => {
    drain
      .mockRejectedValueOnce(new Error('command timed out'))
      .mockResolvedValueOnce([followUp('a', 1, {})]);

    await expect(startQueuedFollowUp(ctx, finished({ topicId: 'tpc-1' }))).resolves.toEqual({
      operationId: 'op-2',
    });

    const [first, second] = drain.mock.calls;
    expect(second[3]).toBe(first[3]);
  });

  it('does not fail when returning follow-ups fails — their batch lapses back on its own', async () => {
    drain.mockResolvedValue([followUp('a', 1, {})]);
    startComposerRun.mockRejectedValue(new Error('topic busy'));
    settle.mockRejectedValue(new Error('redis down'));

    await expect(startQueuedFollowUp(ctx, finished({ topicId: 'tpc-1' }))).resolves.toBeUndefined();
  });
});
