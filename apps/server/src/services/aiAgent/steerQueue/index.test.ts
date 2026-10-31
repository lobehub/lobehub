import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  mergeQueuedFollowUps,
  type QueuedFollowUp,
  queuedUserMessageId,
  startQueuedFollowUp,
  takeSameSenderFollowUps,
} from './index';

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
const { findMessageById } = vi.hoisted(() => ({ findMessageById: vi.fn() }));
vi.mock('@/database/models/message', () => ({
  MessageModel: class {
    findById = findMessageById;
  },
}));
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

describe('takeSameSenderFollowUps', () => {
  const writer = { agentId: 'agt-writer', topicId: 'tpc-writer' };
  const reviewer = { agentId: 'agt-reviewer', topicId: 'tpc-reviewer' };

  it('takes the leading follow-ups of one author, in queue order', () => {
    const a = { ...followUp('a', 2, {}), agentSender: writer };
    const b = { ...followUp('b', 1, {}), agentSender: writer };
    const c = { ...followUp('c', 3, {}), agentSender: reviewer };
    const d = followUp('d', 4, {});

    expect(takeSameSenderFollowUps([a, c, b, d])).toEqual({
      agentSender: writer,
      rest: [c, d],
      taken: [b, a],
    });
  });

  it('keeps a person’s follow-ups together, with no sender', () => {
    const entries = [followUp('a', 1, {}), followUp('b', 2, {})];

    expect(takeSameSenderFollowUps(entries)).toEqual({
      agentSender: undefined,
      rest: [],
      taken: entries,
    });
    expect(takeSameSenderFollowUps([])).toEqual({ rest: [], taken: [] });
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
    findMessageById.mockResolvedValue(undefined);
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

  it('starts an agent’s follow-ups as a turn authored by that agent, one author at a time', async () => {
    const writer = { agentId: 'agt-writer', hop: 2, topicId: 'tpc-writer' };
    const typed = followUp('typed', 3, {});
    drain.mockResolvedValue([
      { ...followUp('a', 1, {}), agentSender: writer },
      { ...followUp('b', 2, {}), agentSender: writer },
      typed,
    ]);

    await startQueuedFollowUp(ctx, finished({ topicId: 'tpc-1' }));

    expect(startComposerRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ agentSender: writer, prompt: 'a\n\nb' }),
    );
    // The person's follow-up waits for the turn this starts to finish.
    expect(settle).toHaveBeenCalledWith(expect.anything(), expect.any(String), [typed.id]);
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

  it('sends a batch under one user message id that every attempt at it shares', async () => {
    drain.mockResolvedValue([followUp('b', 2, {}), followUp('a', 1, {})]);
    startComposerRun.mockRejectedValueOnce(new Error('topic busy'));

    await startQueuedFollowUp(ctx, finished({ topicId: 'tpc-1' }));
    drain.mockResolvedValue([followUp('a', 1, {}), followUp('b', 2, {})]);
    await startQueuedFollowUp(ctx, finished({ topicId: 'tpc-1' }));

    const [first, second] = startComposerRun.mock.calls.map(([, request]) => request);
    expect(first.clientIds.userMessageId).toMatch(/^msg_[\da-f]{24}$/);
    expect(second.clientIds.userMessageId).toBe(first.clientIds.userMessageId);
    // A single follow-up keeps the id its optimistic row was minted under.
    const single = [followUp('a', 1, { clientIds: { userMessageId: 'msg_client' } })];
    expect(queuedUserMessageId('user-1', single, mergeQueuedFollowUps(single))).toBe('msg_client');
  });

  it('acknowledges the follow-ups when the start failed after writing the user message', async () => {
    // Regression: a start can write the message and still fail (a Task run lost
    // to a concurrent send is stopped and rejected). Returning the follow-ups
    // made the next run that ended send the same message again.
    drain.mockResolvedValue([followUp('a', 1, {}), followUp('b', 2, {})]);
    startComposerRun.mockImplementation(async (_ctx, request) => {
      findMessageById.mockImplementation(async (id: string) =>
        id === request.clientIds.userMessageId ? { id } : undefined,
      );
      throw new TRPCError({ code: 'CONFLICT', message: 'Another run is already live' });
    });

    await expect(startQueuedFollowUp(ctx, finished({ topicId: 'tpc-1' }))).resolves.toBeUndefined();

    expect(settle).toHaveBeenCalledOnce();
    expect(settle).toHaveBeenCalledWith(
      { threadId: null, topicId: 'tpc-1', userId: 'user-1' },
      expect.any(String),
    );
  });

  it('acknowledges a batch an earlier attempt already wrote, without starting it again', async () => {
    drain.mockResolvedValue([followUp('a', 1, { clientIds: { userMessageId: 'msg_written' } })]);
    findMessageById.mockImplementation(async (id: string) =>
      id === 'msg_written' ? { id } : undefined,
    );

    await expect(startQueuedFollowUp(ctx, finished({ topicId: 'tpc-1' }))).resolves.toBeUndefined();

    expect(startComposerRun).not.toHaveBeenCalled();
    expect(settle).toHaveBeenCalledWith(
      expect.objectContaining({ topicId: 'tpc-1' }),
      expect.any(String),
    );
  });

  it('puts the follow-ups back when it cannot tell whether a failed start wrote the message', async () => {
    const entries = [followUp('a', 1, {})];
    drain.mockResolvedValue(entries);
    startComposerRun.mockRejectedValue(new Error('topic busy'));
    findMessageById.mockRejectedValue(new Error('connection reset'));

    await startQueuedFollowUp(ctx, finished({ topicId: 'tpc-1' }));

    expect(settle).toHaveBeenCalledWith(
      expect.objectContaining({ topicId: 'tpc-1' }),
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
