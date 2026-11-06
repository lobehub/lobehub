import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SteerQueueWriteUnknownError } from '@/server/services/redis/steerQueue';

import { queueSubAgentSteer } from './subAgent';

const mocks = vi.hoisted(() => ({
  append: vi.fn(),
  isRunAlive: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@/server/services/redis', () => ({
  redisService: { steerQueue: { append: mocks.append, remove: mocks.remove } },
}));
vi.mock('./liveRuns', () => ({ isRunAlive: mocks.isRunAlive }));

const ctx = { db: {} as any, userId: 'user-1', workspaceId: 'ws-1' };
const params = {
  agentId: 'agt-1',
  instruction: 'Only cover 2025',
  operationId: 'op-child',
  threadId: 'thd-sub',
  topicId: 'tpc-1',
};
const scope = { threadId: 'thd-sub', topicId: 'tpc-1', userId: 'user-1' };

describe('queueSubAgentSteer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.append.mockResolvedValue(1);
    mocks.isRunAlive.mockResolvedValue(true);
  });

  it('queues the instruction behind the running sub-agent on its thread', async () => {
    await expect(queueSubAgentSteer(ctx, params)).resolves.toEqual({ queued: true });

    expect(mocks.append).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({
        request: expect.objectContaining({ agentId: 'agt-1', prompt: 'Only cover 2025' }),
        subAgentSteer: true,
        userId: 'user-1',
      }),
      'op-child',
    );
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('takes the instruction back when the run ended meanwhile', async () => {
    mocks.isRunAlive.mockResolvedValue(false);
    mocks.remove.mockResolvedValue(true);

    await expect(queueSubAgentSteer(ctx, params)).resolves.toEqual({
      queued: false,
      reason: 'ended',
    });
    const entry = mocks.append.mock.calls[0][1];
    expect(mocks.remove).toHaveBeenCalledWith(scope, entry.id);
  });

  it('reports it queued when the ending run already took it', async () => {
    mocks.isRunAlive.mockResolvedValue(false);
    mocks.remove.mockResolvedValue(false);

    await expect(queueSubAgentSteer(ctx, params)).resolves.toEqual({ queued: true });
  });

  it.each([
    ['the queue is full', () => mocks.append.mockResolvedValue('full'), 'full'],
    ['Redis is missing', () => mocks.append.mockResolvedValue(undefined), 'unavailable'],
    ['the write was taken back', () => mocks.append.mockResolvedValue('notStored'), 'unavailable'],
    [
      'the write outcome is unknown',
      () => mocks.append.mockRejectedValue(new SteerQueueWriteUnknownError(new Error('timeout'))),
      'unavailable',
    ],
  ])('refuses when %s', async (_case, arrange, reason) => {
    arrange();

    await expect(queueSubAgentSteer(ctx, params)).resolves.toEqual({ queued: false, reason });
  });
});
