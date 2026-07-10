// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type AgentSignalRedisTestGlobal,
  installStatefulRedisMock,
  lastCasClient,
  mockRedis,
  queueExecConflict,
  resetRedisState,
  secondSource,
  source,
} from './redisTestUtils';

const loadStore = async () => {
  vi.resetModules();
  (globalThis as AgentSignalRedisTestGlobal).__agentSignalRedisClient = mockRedis;

  return import('../adapters/redis/runtimeWaypointStore');
};

describe('redis runtime-waypoint store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRedisState();
    installStatefulRedisMock();
    (globalThis as AgentSignalRedisTestGlobal).__agentSignalRedisClient = mockRedis;
  });

  it('keeps both events when appends happen concurrently on the same scope', async () => {
    const store = await loadStore();

    await Promise.all([store.append('topic:t1', source), store.append('topic:t1', secondSource)]);

    await expect(store.load('topic:t1')).resolves.toEqual({
      events: [source, secondSource],
      nextHop: undefined,
      pending: undefined,
      scopeKey: 'topic:t1',
      terminal: undefined,
    });
  });

  it('retries claim after optimistic-lock invalidation on an isolated CAS client', async () => {
    const store = await loadStore();

    await store.append('topic:t1', source);
    queueExecConflict();

    await expect(store.claim('topic:t1')).resolves.toEqual({
      scopeKey: 'topic:t1',
      source,
      status: 'pending',
    });

    expect(mockRedis.duplicate).toHaveBeenCalledTimes(1);
    expect(lastCasClient()?.watch).toHaveBeenCalledWith(
      'agent-signal:waypoint:topic:t1',
      'agent-signal:waypoint:topic:t1:events',
    );
    expect(lastCasClient()?.quit).toHaveBeenCalledTimes(1);
  });

  it('ignores terminal transitions for a source that is not currently pending', async () => {
    const store = await loadStore();

    await store.append('topic:t1', source);
    await store.append('topic:t1', secondSource);

    await expect(store.claim('topic:t1')).resolves.toEqual({
      scopeKey: 'topic:t1',
      source,
      status: 'pending',
    });

    await store.complete({
      completedAt: 1_500,
      scopeKey: 'topic:t1',
      sourceId: secondSource.sourceId,
    });

    await expect(store.load('topic:t1')).resolves.toEqual({
      events: [source, secondSource],
      nextHop: undefined,
      pending: {
        scopeKey: 'topic:t1',
        source,
        status: 'pending',
      },
      scopeKey: 'topic:t1',
      terminal: undefined,
    });

    await expect(store.claim('topic:t1')).resolves.toEqual({
      scopeKey: 'topic:t1',
      source,
      status: 'pending',
    });

    await store.complete({
      completedAt: 1_600,
      scopeKey: 'topic:t1',
      sourceId: source.sourceId,
    });

    await expect(store.claim('topic:t1')).resolves.toEqual({
      scopeKey: 'topic:t1',
      source: secondSource,
      status: 'pending',
    });
  });

  it('fails claim after exhausting optimistic-lock retries', async () => {
    const store = await loadStore();

    await store.append('topic:t1', source);
    queueExecConflict(5);

    await expect(store.claim('topic:t1')).rejects.toThrow(
      'Failed to claim waypoint for scope "topic:t1" after retrying',
    );
    expect(lastCasClient()?.quit).toHaveBeenCalledTimes(1);
  });
});
