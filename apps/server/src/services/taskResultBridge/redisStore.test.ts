// @vitest-environment node
import type Redis from 'ioredis';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskResultCallbackRedisStore } from './redisStore';

const createRedis = () => {
  const transaction = {
    exec: vi.fn().mockResolvedValue([]),
    hset: vi.fn(),
  };
  transaction.hset.mockReturnValue(transaction);

  return {
    eval: vi.fn(),
    get: vi.fn(),
    hget: vi.fn(),
    hgetall: vi.fn(),
    lrange: vi.fn(),
    multi: vi.fn(() => transaction),
    transaction,
    zrange: vi.fn(),
    zrem: vi.fn(),
  };
};

describe('TaskResultCallbackRedisStore', () => {
  let redis: ReturnType<typeof createRedis>;

  beforeEach(() => {
    redis = createRedis();
  });

  it('requires Redis instead of silently losing a callback', () => {
    expect(() => new TaskResultCallbackRedisStore('user-1', 'topic-1', undefined, null)).toThrow(
      'Redis is required for task result callbacks',
    );
  });

  it('creates an idempotent pending receipt with a scoped recovery entry', async () => {
    redis.eval.mockResolvedValue('pending');
    const store = new TaskResultCallbackRedisStore(
      'user-1',
      'topic-1',
      'workspace-1',
      redis as unknown as Redis,
    );

    await store.createPending({
      agentId: 'agent-1',
      callbackMessageId: 'message-1',
      operationId: 'operation-1',
      taskId: 'task-1',
    });

    expect(redis.eval).toHaveBeenCalledTimes(1);
    expect(redis.eval.mock.calls[0].slice(0, 6)).toEqual([
      expect.stringContaining("local status = redis.call('HGET'"),
      4,
      'task-result-callback:receipt:operation-1',
      'task-result-callback:pending:user-1:workspace-1:topic-1',
      'task-result-callback:scope:user-1:workspace-1:topic-1',
      'task-result-callback:recovery',
    ]);
    expect(redis.eval.mock.calls[0].slice(-10)).toEqual([
      'agentId',
      'agent-1',
      'originTopicId',
      'topic-1',
      'userId',
      'user-1',
      'workspaceId',
      'workspace-1',
      expect.any(String),
      'user-1:workspace-1:topic-1',
    ]);
  });

  it('claims the pending batch and hydrates its receipt payloads', async () => {
    redis.eval.mockResolvedValue(['operation-1']);
    redis.hgetall.mockResolvedValue({
      attempts: '1',
      callbackMessageId: 'message-1',
      id: 'operation-1',
      operationId: 'operation-1',
      originTopicId: 'topic-1',
      status: 'processing',
      taskId: 'task-1',
      updatedAt: '123',
      userId: 'user-1',
      workspaceId: '',
    });
    const store = new TaskResultCallbackRedisStore(
      'user-1',
      'topic-1',
      undefined,
      redis as unknown as Redis,
    );

    await expect(store.claimPending()).resolves.toEqual([
      expect.objectContaining({
        attempts: 1,
        callbackMessageId: 'message-1',
        id: 'operation-1',
        status: 'processing',
      }),
    ]);
  });

  it('recognizes a fully delivered batch for webhook dedupe', async () => {
    redis.hget.mockResolvedValue('delivered');
    const store = new TaskResultCallbackRedisStore(
      'user-1',
      'topic-1',
      undefined,
      redis as unknown as Redis,
    );

    await expect(store.areDelivered(['operation-1', 'operation-2'])).resolves.toBe(true);
  });

  it('stores a monotonic per-operation delivery checkpoint', async () => {
    redis.eval.mockResolvedValue(2);
    const store = new TaskResultCallbackRedisStore(
      'user-1',
      'topic-1',
      undefined,
      redis as unknown as Redis,
    );

    await store.markDeliveryChunk('creator-operation-1', 2);

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('if next > current'),
      1,
      'task-result-callback:delivery:creator-operation-1',
      2,
      6 * 60 * 60,
    );
  });

  it('returns due recovery scopes and prunes expired scope metadata', async () => {
    redis.zrange.mockResolvedValue(['valid-scope', 'expired-scope']);
    redis.hgetall
      .mockResolvedValueOnce({
        agentId: 'agent-1',
        originTopicId: 'topic-1',
        userId: 'user-1',
      })
      .mockResolvedValueOnce({});

    await expect(
      TaskResultCallbackRedisStore.findRecoverableScopes(redis as unknown as Redis),
    ).resolves.toEqual([
      {
        agentId: 'agent-1',
        originTopicId: 'topic-1',
        scopeKey: 'valid-scope',
        userId: 'user-1',
        workspaceId: undefined,
      },
    ]);
    expect(redis.zrem).toHaveBeenCalledWith('task-result-callback:recovery', 'expired-scope');
  });

  it('requeues a stale processing batch for watchdog recovery', async () => {
    redis.get.mockResolvedValue('1');
    redis.lrange.mockResolvedValue(['operation-1']);
    redis.eval.mockResolvedValue(1);
    const store = new TaskResultCallbackRedisStore(
      'user-1',
      'topic-1',
      undefined,
      redis as unknown as Redis,
    );

    await store.resetStaleProcessing();

    expect(redis.lrange).toHaveBeenCalledWith(
      'task-result-callback:processing:user-1:personal:topic-1',
      0,
      -1,
    );
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("'status', 'pending'"),
      4,
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'Creator callback processing timed out',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'operation-1',
    );
  });

  it('keeps a delivered marker so a delayed QStash redelivery stays deduped', async () => {
    redis.eval.mockResolvedValue(1);
    const store = new TaskResultCallbackRedisStore(
      'user-1',
      'topic-1',
      undefined,
      redis as unknown as Redis,
    );

    await store.settle(['operation-1']);

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("'status', 'delivered'"),
      4,
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'task-result-callback:receipt:',
      expect.anything(),
      String(6 * 60 * 60),
      'user-1:personal:topic-1',
      expect.anything(),
      'operation-1',
    );
  });
});
