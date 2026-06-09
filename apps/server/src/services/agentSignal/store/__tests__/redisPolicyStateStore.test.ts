// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type AgentSignalRedisTestGlobal,
  hashes,
  installStatefulRedisMock,
  mockRedis,
  resetRedisState,
} from './redisTestUtils';

const loadStore = async () => {
  vi.resetModules();
  (globalThis as AgentSignalRedisTestGlobal).__agentSignalRedisClient = mockRedis;

  return import('../adapters/redis/policyStateStore');
};

describe('redis policy-state store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRedisState();
    installStatefulRedisMock();
    (globalThis as AgentSignalRedisTestGlobal).__agentSignalRedisClient = mockRedis;
  });

  it('reads and writes policy state as hash payload', async () => {
    const store = await loadStore();

    hashes.set('agent-signal:policy:sample.policy:topic:t1', { lastNudgedAt: '1000' });

    await expect(store.readPolicyState('sample.policy', 'topic:t1')).resolves.toEqual({
      lastNudgedAt: '1000',
    });
    await store.writePolicyState('sample.policy', 'topic:t1', { lastNudgedAt: '2000' }, 60);

    expect(mockRedis.hset).toHaveBeenCalledWith('agent-signal:policy:sample.policy:topic:t1', {
      lastNudgedAt: '2000',
    });
  });

  it('returns undefined when hgetall returns an empty hash', async () => {
    const store = await loadStore();

    await expect(store.readPolicyState('sample.policy', 'topic:t1')).resolves.toBeUndefined();
  });

  it('treats writes as no-op when redis is unavailable', async () => {
    const store = await loadStore();

    (globalThis as AgentSignalRedisTestGlobal).__agentSignalRedisClient = null;

    await expect(
      store.writePolicyState('sample.policy', 'topic:t1', { eventCount: '1' }, 10),
    ).resolves.toBeUndefined();
    expect(mockRedis.hset).not.toHaveBeenCalled();
    expect(mockRedis.expire).not.toHaveBeenCalled();
  });
});
