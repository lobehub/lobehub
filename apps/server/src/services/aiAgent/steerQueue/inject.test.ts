import type { AgentState } from '@lobechat/agent-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { QueuedFollowUp } from './index';
import { canJoinRunningTurn, injectQueuedFollowUp } from './inject';

const mocks = vi.hoisted(() => ({
  assertCanUseAgentRunConversation: vi.fn(),
  assertCanUseWorkspaceAgent: vi.fn(),
  boundOperations: vi.fn(),
  create: vi.fn(),
  drain: vi.fn(),
  isRunAlive: vi.fn(),
  resolveParentId: vi.fn(),
  restore: vi.fn(),
  settle: vi.fn(),
}));

vi.mock('@/server/services/redis', () => ({
  redisService: {
    steerQueue: {
      boundOperations: mocks.boundOperations,
      drain: mocks.drain,
      restore: mocks.restore,
      settle: mocks.settle,
    },
  },
}));
vi.mock('./liveRuns', () => ({ isRunAlive: mocks.isRunAlive }));
vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(function () {
    return { create: mocks.create };
  }),
}));
vi.mock('../pipeline/resolveUserMessageParentId', () => ({
  createUserTurnAnchor: () => ({ resolveParentId: mocks.resolveParentId }),
}));
vi.mock('@/server/routers/lambda/_helpers/workspaceAgentGuard', () => ({
  assertCanUseWorkspaceAgent: mocks.assertCanUseWorkspaceAgent,
}));
vi.mock('@/server/routers/lambda/aiAgent/guards', () => ({
  assertCanUseAgentRunConversation: mocks.assertCanUseAgentRunConversation,
}));

const followUp = (
  id: string,
  createdAt: number,
  request: Partial<QueuedFollowUp['request']> = {},
) =>
  ({
    createdAt,
    id,
    request: { agentId: 'agt-1', appContext: { topicId: 'tpc-1' }, prompt: id, ...request },
    userId: 'user-1',
  }) as QueuedFollowUp;

const state = { origin: { agentId: 'agt-1', topicId: 'tpc-1' }, status: 'running' } as AgentState;
const scope = { threadId: null, topicId: 'tpc-1', userId: 'user-1' };
const ctx = { db: {} as any, userId: 'user-1', workspaceId: 'ws-1' };
const inject = () => injectQueuedFollowUp(ctx, { operationId: 'op-1', scope, state });

describe('canJoinRunningTurn', () => {
  it('takes plain text for the agent that is running', () => {
    expect(canJoinRunningTurn(followUp('a', 1), state)).toBe(true);
  });

  it.each([
    ['an attachment', { fileIds: ['f1'] }],
    [
      'attached content',
      {
        userMessage: {
          metadata: { contextSelections: [{ content: 'q', id: 'c1', source: 'text' as const }] },
        },
      },
    ],
    ['a selected tool', { selectedToolIds: ['t1'] }],
    ['a selected skill', { selectedSkillIds: ['s1'] }],
    ['an @-mention', { mentionedAgents: [{ id: 'a2', name: 'B' }] }],
    ['another agent', { agentId: 'agt-2' }],
    ['no text', { prompt: '  ' }],
  ])('leaves a follow-up with %s to the next turn', (_label, request) => {
    expect(canJoinRunningTurn(followUp('a', 1, request), state)).toBe(false);
  });
});

describe('canJoinRunningTurn — per-turn settings', () => {
  const configured = {
    binding: { device: { id: 'dev-1' } },
    host: {
      acceptsFileWorks: true,
      clientProtocol: 2,
      llmExecutor: {
        capabilities: ['llm_relay@1'],
        channelOperationId: 'op-0',
        clientId: 'tab-1',
        providers: ['ollama'],
      },
    },
    origin: { agentId: 'agt-1', topicId: 'tpc-1' },
    principal: { policy: { userIntervention: { allowList: ['a'], approvalMode: 'manual' } } },
    status: 'running',
  } as unknown as AgentState;
  const same = {
    acceptsFileWorks: true,
    clientProtocol: 2 as const,
    deviceId: 'dev-1',
    llmExecutor: { clientId: 'tab-1', providers: ['ollama'], capabilities: ['llm_relay@1'] },
    userInterventionConfig: { approvalMode: 'manual' as const, allowList: ['a'] },
  };

  it('joins when every stated setting is the running turn’s, in any key order', () => {
    expect(canJoinRunningTurn(followUp('a', 1, same), configured)).toBe(true);
    expect(canJoinRunningTurn(followUp('a', 1, { acceptsFileWorks: true }), configured)).toBe(true);
  });

  it.each([
    ['another device', { deviceId: 'dev-2' }],
    ['another local device hint', { localDeviceId: 'dev-2' }],
    ['another LLM executor', { llmExecutor: { ...same.llmExecutor, clientId: 'tab-2' } }],
    ['another wire protocol', { clientProtocol: 1 as const }],
    ['another approval mode', { userInterventionConfig: { approvalMode: 'auto-run' as const } }],
    ['other stream features', { acceptsFileWorks: false }],
  ])('holds a follow-up sent with %s for the next turn', (_label, change) => {
    expect(canJoinRunningTurn(followUp('a', 1, { ...same, ...change }), configured)).toBe(false);
  });
});

describe('injectQueuedFollowUp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.drain.mockResolvedValue([]);
    mocks.restore.mockResolvedValue(undefined);
    mocks.settle.mockResolvedValue(undefined);
    mocks.boundOperations.mockResolvedValue({ operationIds: ['op-1'], total: 1 });
    mocks.isRunAlive.mockResolvedValue(true);
    mocks.resolveParentId.mockResolvedValue('msg-assistant');
    mocks.create.mockResolvedValue({ id: 'msg-steer' });
    mocks.assertCanUseWorkspaceAgent.mockResolvedValue(undefined);
    mocks.assertCanUseAgentRunConversation.mockResolvedValue(undefined);
  });

  it('keeps the rich text of a single follow-up that joins the run', async () => {
    const editorData = { root: { children: [], type: 'root' } };
    mocks.drain.mockResolvedValue([followUp('only', 1, { userMessage: { editorData } })]);

    await expect(inject()).resolves.toEqual({ messageId: 'msg-steer' });

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'only', editorData }),
    );
  });

  it('joins the queued follow-ups into the run as one steer user message', async () => {
    mocks.drain.mockResolvedValue([followUp('first', 1), followUp('second', 2)]);

    await expect(inject()).resolves.toEqual({ messageId: 'msg-steer' });

    expect(mocks.drain).toHaveBeenCalledWith(scope, 'op-1', [], expect.any(String));
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agt-1',
        content: 'first\n\nsecond',
        metadata: expect.objectContaining({ steer: true }),
        parentId: 'msg-assistant',
        role: 'user',
        topicId: 'tpc-1',
      }),
    );
    expect(mocks.settle).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    // Delivered into the run: the reserved slots are free again.
    expect(mocks.settle).toHaveBeenCalledWith(scope, expect.any(String));
  });

  it('keeps queue order: joins the leading follow-ups and puts the rest back', async () => {
    const held = [followUp('with-file', 2, { fileIds: ['f1'] }), followUp('after', 3)];
    mocks.drain.mockResolvedValue([followUp('plain', 1), ...held]);

    await expect(inject()).resolves.toEqual({ messageId: 'msg-steer' });

    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ content: 'plain' }));
    expect(mocks.settle).toHaveBeenCalledWith(
      scope,
      expect.any(String),
      held.map((e) => e.id),
    );
  });

  it('joins nothing when the first follow-up needs a turn of its own', async () => {
    const entries = [followUp('with-file', 1, { fileIds: ['f1'] })];
    mocks.drain.mockResolvedValue(entries);

    await expect(inject()).resolves.toBeUndefined();

    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.settle).toHaveBeenCalledWith(
      scope,
      expect.any(String),
      entries.map((e) => e.id),
    );
  });

  it('does not join an old-shape follow-up whose quote sits in top-level selections', async () => {
    // Queued by a client from before `userMessage`. Joined as a plain steer
    // message, its quote would be dropped; it must start a turn of its own.
    const quote = { content: 'Quoted reply', id: 'selection-1', source: 'text' as const };
    const entries = [followUp('legacy', 1, { contextSelections: [quote] } as any)];
    mocks.drain.mockResolvedValue(entries);

    await expect(inject()).resolves.toBeUndefined();

    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.settle).toHaveBeenCalledWith(
      scope,
      expect.any(String),
      entries.map((e) => e.id),
    );
  });

  it('puts the follow-ups back when the message cannot be persisted', async () => {
    const entries = [followUp('a', 1)];
    mocks.drain.mockResolvedValue(entries);
    mocks.create.mockRejectedValue(new Error('db down'));

    await expect(inject()).resolves.toBeUndefined();

    expect(mocks.settle).toHaveBeenCalledWith(
      scope,
      expect.any(String),
      entries.map((e) => e.id),
    );
  });

  it('drops follow-ups whose sender lost access while the run went on', async () => {
    const { TRPCError } = await import('@trpc/server');
    mocks.drain.mockResolvedValue([followUp('a', 1)]);
    mocks.assertCanUseWorkspaceAgent.mockRejectedValue(new TRPCError({ code: 'FORBIDDEN' }));

    await expect(inject()).resolves.toBeUndefined();

    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.settle).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });
});
