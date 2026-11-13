import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  canSteerHeteroRun,
  consumeHeteroSteer,
  releaseHeteroSteers,
  renewHeteroSteers,
  returnHeteroSteer,
  takeHeteroSteer,
} from './hetero';
import type { QueuedFollowUp } from './index';

const mocks = vi.hoisted(() => ({
  assertCanUseAgentRunConversation: vi.fn(),
  assertCanUseWorkspaceAgent: vi.fn(),
  boundOperations: vi.fn(),
  create: vi.fn(),
  deliveries: new Map<string, string>(),
  drain: vi.fn(),
  findById: vi.fn(),
  isRunAlive: vi.fn(),
  renew: vi.fn(),
  settle: vi.fn(),
}));

vi.mock('@/server/services/redis', () => ({
  redisService: {
    steerQueue: {
      boundOperations: mocks.boundOperations,
      drain: mocks.drain,
      listHeteroDeliveries: vi.fn(async () =>
        Object.fromEntries([...mocks.deliveries].map(([id, raw]) => [id, JSON.parse(raw)])),
      ),
      putHeteroDelivery: vi.fn(async (_op: string, id: string, value: unknown) => {
        mocks.deliveries.set(id, JSON.stringify(value));
      }),
      removeHeteroDelivery: vi.fn(async (_op: string, id: string) => {
        mocks.deliveries.delete(id);
      }),
      renew: mocks.renew,
      settle: mocks.settle,
    },
  },
}));
vi.mock('./liveRuns', () => ({ isRunAlive: mocks.isRunAlive }));
vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(function () {
    return { create: mocks.create, findById: mocks.findById };
  }),
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
    request: {
      agentId: 'agt-1',
      appContext: { topicId: 'tpc-1' },
      clientIds: { userMessageId: `msg-${id}` },
      prompt: `prompt ${id}`,
      ...request,
    },
    userId: 'user-1',
  }) as QueuedFollowUp;

const scope = { threadId: null, topicId: 'tpc-1', userId: 'user-1' };
const ctx = { db: {} as any, userId: 'user-1', workspaceId: 'ws-1' };
const take = () => takeHeteroSteer(ctx, { agentId: 'agt-1', operationId: 'op-1', scope });
const messageModel = { create: mocks.create, findById: mocks.findById } as any;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.deliveries.clear();
  mocks.boundOperations.mockResolvedValue({ operationIds: ['op-1'], total: 1 });
  mocks.drain.mockResolvedValue([]);
  mocks.findById.mockResolvedValue(undefined);
  mocks.settle.mockResolvedValue(undefined);
  mocks.renew.mockResolvedValue(true);
});

describe('canSteerHeteroRun', () => {
  it('takes plain text for the running agent', () => {
    expect(canSteerHeteroRun(followUp('a', 1), 'agt-1')).toBe(true);
  });

  it.each([
    ['an attachment', { fileIds: ['f1'] }],
    ['a selected tool', { selectedToolIds: ['t1'] }],
    ['an @-mention', { mentionedAgents: [{ id: 'a2', name: 'B' }] }],
    ['another agent', { agentId: 'agt-2' }],
    ['no text', { prompt: ' ' }],
  ])('leaves a follow-up with %s to the next turn', (_label, request) => {
    expect(canSteerHeteroRun(followUp('a', 1, request), 'agt-1')).toBe(false);
  });
});

describe('takeHeteroSteer', () => {
  it('hands out the first follow-up and returns the rest to the queue', async () => {
    mocks.drain.mockResolvedValue([followUp('a', 1), followUp('b', 2)]);

    await expect(take()).resolves.toEqual({ content: 'prompt a', messageId: 'msg-a' });

    // `b` goes back; `a` stays in the leased batch until Claude Code picks it up.
    const [, drained, returned] = mocks.settle.mock.calls[0];
    expect(returned).toEqual(['b']);
    expect(mocks.deliveries.get('msg-a')).toContain(`"drainId":"${drained}"`);
  });

  it('leaves the queue to the run end when the first follow-up cannot join', async () => {
    mocks.drain.mockResolvedValue([followUp('a', 1, { fileIds: ['f1'] }), followUp('b', 2)]);

    await expect(take()).resolves.toBeUndefined();

    expect(mocks.settle.mock.calls[0][2]).toEqual(['a', 'b']);
    expect(mocks.deliveries.size).toBe(0);
  });

  it('does not send a follow-up twice when its batch lapsed back', async () => {
    mocks.deliveries.set(
      'msg-a',
      JSON.stringify({ content: 'prompt a', drainId: 'old', entryId: 'a', scope }),
    );
    mocks.drain.mockResolvedValue([followUp('a', 1)]);

    await expect(take()).resolves.toBeUndefined();

    expect(JSON.parse(mocks.deliveries.get('msg-a')!).drainId).not.toBe('old');
  });

  it('acknowledges a follow-up whose message is already written', async () => {
    mocks.drain.mockResolvedValue([followUp('a', 1)]);
    mocks.findById.mockResolvedValue({ id: 'msg-a' });

    await expect(take()).resolves.toBeUndefined();

    expect(mocks.settle).toHaveBeenLastCalledWith(scope, expect.any(String));
    expect(mocks.deliveries.size).toBe(0);
  });
});

describe('renewHeteroSteers', () => {
  it('extends the lease of every message the session still holds', async () => {
    mocks.deliveries.set('msg-a', JSON.stringify({ drainId: 'd1', entryId: 'a', scope }));

    await renewHeteroSteers('op-1');

    expect(mocks.renew).toHaveBeenCalledWith(scope, 'd1');
  });
});

describe('returnHeteroSteer / releaseHeteroSteers', () => {
  it('puts a refused message back in the queue', async () => {
    mocks.deliveries.set('msg-a', JSON.stringify({ drainId: 'd1', entryId: 'a', scope }));

    await returnHeteroSteer('op-1', 'msg-a');

    expect(mocks.settle).toHaveBeenCalledWith(scope, 'd1', ['a']);
    expect(mocks.deliveries.size).toBe(0);
  });

  it('puts back every message a finished run never picked up', async () => {
    mocks.deliveries.set('msg-a', JSON.stringify({ drainId: 'd1', entryId: 'a', scope }));
    mocks.deliveries.set('msg-b', JSON.stringify({ drainId: 'd2', entryId: 'b', scope }));

    await releaseHeteroSteers('op-1');

    expect(mocks.settle).toHaveBeenCalledWith(scope, 'd1', ['a']);
    expect(mocks.settle).toHaveBeenCalledWith(scope, 'd2', ['b']);
  });
});

describe('consumeHeteroSteer', () => {
  const consume = (messageId = 'msg-a') =>
    consumeHeteroSteer(messageModel, {
      agentId: 'agt-1',
      messageId,
      operationId: 'op-1',
      parentId: 'asst-1',
      topicId: 'tpc-1',
    });

  it('writes the picked-up message as a steer user message and acknowledges it', async () => {
    mocks.deliveries.set(
      'msg-a',
      JSON.stringify({ content: 'use pnpm', drainId: 'd1', entryId: 'a', scope }),
    );

    const message = await consume();

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'use pnpm',
        metadata: expect.objectContaining({ operationId: 'op-1', steer: true }),
        parentId: 'asst-1',
        role: 'user',
        topicId: 'tpc-1',
      }),
      'msg-a',
    );
    expect(mocks.settle).toHaveBeenCalledWith(scope, 'd1');
    expect(message).toMatchObject({ content: 'use pnpm', id: 'msg-a', parentId: 'asst-1' });
    expect(mocks.deliveries.size).toBe(0);
  });

  it('ignores a replay that is not a delivery (the run prompt)', async () => {
    await expect(consume('uuid-prompt')).resolves.toBeUndefined();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('returns the written message on a retried batch', async () => {
    mocks.findById.mockResolvedValue({
      content: 'use pnpm',
      id: 'msg-a',
      metadata: { steer: true },
      parentId: 'asst-1',
      role: 'user',
      topicId: 'tpc-1',
    });

    await expect(consume()).resolves.toMatchObject({ id: 'msg-a', parentId: 'asst-1' });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
