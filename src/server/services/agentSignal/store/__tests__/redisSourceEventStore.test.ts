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

  return import('../adapters/redis/sourceEventStore');
};

describe('redis source-event store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRedisState();
    installStatefulRedisMock();
    (globalThis as AgentSignalRedisTestGlobal).__agentSignalRedisClient = mockRedis;
  });

  it('dedupe accepts first write and rejects duplicate', async () => {
    const store = await loadStore();

    mockRedis.set.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);

    await expect(store.tryDedupe('event_1', 60)).resolves.toBe(true);
    await expect(store.tryDedupe('event_1', 60)).resolves.toBe(false);
    expect(mockRedis.set).toHaveBeenNthCalledWith(
      1,
      'agent-signal:dedupe:event_1',
      '1',
      'EX',
      60,
      'NX',
    );
  });

  it('acquires and releases scope lock', async () => {
    const store = await loadStore();

    mockRedis.set.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);

    await expect(store.acquireScopeLock('topic:t1', 10)).resolves.toBe(true);
    await expect(store.acquireScopeLock('topic:t1', 10)).resolves.toBe(false);
    await store.releaseScopeLock('topic:t1');

    expect(mockRedis.del).toHaveBeenCalledWith('agent-signal:lock:topic:t1');
  });

  it('reads and writes window state as hash payload', async () => {
    const store = await loadStore();

    hashes.set('agent-signal:window:topic:t1', { eventCount: '2', lastEventId: 'evt_2' });

    await expect(store.readWindow('topic:t1')).resolves.toEqual({
      eventCount: '2',
      lastEventId: 'evt_2',
    });
    await store.writeWindow('topic:t1', { eventCount: '3' }, 300);

    expect(mockRedis.hset).toHaveBeenCalledWith('agent-signal:window:topic:t1', {
      eventCount: '3',
    });
    expect(mockRedis.expire).toHaveBeenCalledWith('agent-signal:window:topic:t1', 300);
  });

  it('returns undefined when hgetall returns an empty hash', async () => {
    const store = await loadStore();

    await expect(store.readWindow('topic:t1')).resolves.toBeUndefined();
  });

  it('returns false for dedupe and lock when redis is unavailable', async () => {
    const store = await loadStore();

    (globalThis as AgentSignalRedisTestGlobal).__agentSignalRedisClient = null;

    await expect(store.tryDedupe('event_1', 60)).resolves.toBe(false);
    await expect(store.acquireScopeLock('topic:t1', 60)).resolves.toBe(false);
  });

  it('treats writes as no-op when redis is unavailable', async () => {
    const store = await loadStore();

    (globalThis as AgentSignalRedisTestGlobal).__agentSignalRedisClient = null;

    await expect(store.writeWindow('topic:t1', { eventCount: '1' }, 10)).resolves.toBeUndefined();
    await expect(store.releaseScopeLock('topic:t1')).resolves.toBeUndefined();
    expect(mockRedis.hset).not.toHaveBeenCalled();
    expect(mockRedis.expire).not.toHaveBeenCalled();
  });

  it('skips empty hash writes', async () => {
    const store = await loadStore();

    await store.writeWindow('topic:t1', {}, 10);

    expect(mockRedis.hset).not.toHaveBeenCalled();
    expect(mockRedis.expire).not.toHaveBeenCalled();
  });
});
