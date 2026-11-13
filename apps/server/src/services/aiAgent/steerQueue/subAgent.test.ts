import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SteerQueueWriteUnknownError } from '@/server/services/redis/steerQueue';

import { queueSubAgentSteer } from './subAgent';

const mocks = vi.hoisted(() => ({
  append: vi.fn(),
  isRunAlive: vi.fn(),
  isSealed: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@/server/services/redis', () => ({
  redisService: {
    steerQueue: { append: mocks.append, isSealed: mocks.isSealed, remove: mocks.remove },
  },
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
    mocks.isSealed.mockResolvedValue(false);
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

  it('takes the instruction back when the run already made its last read', async () => {
    // Still alive by its row, but past the final queue read it seals before.
    mocks.isSealed.mockResolvedValue(true);
    mocks.remove.mockResolvedValue(true);

    await expect(queueSubAgentSteer(ctx, params)).resolves.toEqual({
      queued: false,
      reason: 'ended',
    });
    expect(mocks.isSealed).toHaveBeenCalledWith('op-child');
  });

  it('takes the instruction back when the seal cannot be read', async () => {
    mocks.isSealed.mockRejectedValue(new Error('redis down'));
    mocks.remove.mockResolvedValue(true);

    await expect(queueSubAgentSteer(ctx, params)).resolves.toEqual({
      queued: false,
      reason: 'ended',
    });
  });

  it('retries an unknown write with the same entry id', async () => {
    mocks.append
      .mockRejectedValueOnce(new SteerQueueWriteUnknownError(new Error('timeout')))
      .mockResolvedValueOnce(1);

    await expect(queueSubAgentSteer(ctx, params)).resolves.toEqual({ queued: true });
    const [first, second] = mocks.append.mock.calls;
    expect(second[1].id).toBe(first[1].id);
  });

  it('reports it queued when the retry finds the earlier write already taken', async () => {
    mocks.append
      .mockRejectedValueOnce(new SteerQueueWriteUnknownError(new Error('timeout')))
      .mockResolvedValueOnce('taken');

    await expect(queueSubAgentSteer(ctx, params)).resolves.toEqual({ queued: true });
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it.each([
    [
      'the retry is unknown too',
      () => mocks.append.mockRejectedValue(new SteerQueueWriteUnknownError(new Error('timeout'))),
    ],
    [
      'Redis is gone on the retry',
      () =>
        mocks.append
          .mockRejectedValueOnce(new SteerQueueWriteUnknownError(new Error('timeout')))
          .mockResolvedValueOnce(undefined),
    ],
  ])('reports the outcome unknown, not unavailable, when %s', async (_case, arrange) => {
    arrange();

    await expect(queueSubAgentSteer(ctx, params)).resolves.toEqual({
      queued: false,
      reason: 'unknown',
    });
  });

  it.each([
    [
      'the run’s status cannot be read',
      () => mocks.isRunAlive.mockRejectedValue(new Error('db down')),
    ],
    [
      'the take-back fails',
      () => {
        mocks.isRunAlive.mockResolvedValue(false);
        mocks.remove.mockRejectedValue(new Error('redis down'));
      },
    ],
  ])('reports a stored instruction unknown when %s after the append', async (_case, arrange) => {
    arrange();

    // Stored already, and the run may be following it: a resend could run it twice.
    await expect(queueSubAgentSteer(ctx, params)).resolves.toEqual({
      queued: false,
      reason: 'unknown',
    });
    expect(mocks.append).toHaveBeenCalledTimes(1);
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
  ])('refuses when %s', async (_case, arrange, reason) => {
    arrange();

    await expect(queueSubAgentSteer(ctx, params)).resolves.toEqual({ queued: false, reason });
  });
});
