// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type AgentSignalRedisTestGlobal,
  installStatefulRedisMock,
  mockRedis,
  resetRedisState,
} from './redisTestUtils';

const loadStore = async () => {
  vi.resetModules();
  (globalThis as AgentSignalRedisTestGlobal).__agentSignalRedisClient = mockRedis;

  return import('../adapters/redis/receiptStore');
};

const receipt = {
  agentId: 'agent-1',
  anchorMessageId: 'assistant-1',
  createdAt: 1_700_000,
  detail: 'Saved this for future replies',
  id: 'receipt-1',
  kind: 'memory' as const,
  operationId: 'op-1',
  sourceId: 'source-1',
  sourceType: 'client.gateway.runtime_end',
  status: 'applied' as const,
  target: {
    summary: 'Use short answers in future chats',
    title: 'Short answer preference',
    type: 'memory' as const,
  },
  title: 'Memory saved',
  topicId: 'topic-1',
  userId: 'user-1',
};

describe('redis receipt store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRedisState();
    installStatefulRedisMock();
    (globalThis as AgentSignalRedisTestGlobal).__agentSignalRedisClient = mockRedis;
  });

  it('appends a receipt payload and indexes it by user, agent, and topic', async () => {
    const store = await loadStore();

    await expect(store.appendReceipt(receipt, 259_200)).resolves.toBe(true);

    expect(mockRedis.hset).toHaveBeenCalledWith('agent-signal:receipt:receipt-1', {
      agentId: 'agent-1',
      anchorMessageId: 'assistant-1',
      createdAt: '1700000',
      detail: 'Saved this for future replies',
      id: 'receipt-1',
      kind: 'memory',
      operationId: 'op-1',
      sourceId: 'source-1',
      sourceType: 'client.gateway.runtime_end',
      status: 'applied',
      target: JSON.stringify({
        summary: 'Use short answers in future chats',
        title: 'Short answer preference',
        type: 'memory',
      }),
      title: 'Memory saved',
      topicId: 'topic-1',
      userId: 'user-1',
    });
    expect(mockRedis.zadd).toHaveBeenCalledWith(
      'agent-signal:receipts:user:user-1:agent:agent-1:topic:topic-1',
      1_700_000,
      'receipt-1',
    );
    expect(mockRedis.expire).toHaveBeenCalledWith('agent-signal:receipt:receipt-1', 259_200);
  });

  it('lists newest receipts and removes dangling index members', async () => {
    const store = await loadStore();

    await store.appendReceipt(receipt, 259_200);
    await store.appendReceipt({ ...receipt, createdAt: 1_700_010, id: 'receipt-2' }, 259_200);
    await mockRedis.zadd(
      'agent-signal:receipts:user:user-1:agent:agent-1:topic:topic-1',
      1_700_020,
      'expired-receipt',
    );

    await expect(
      store.listReceipts({ agentId: 'agent-1', limit: 10, topicId: 'topic-1', userId: 'user-1' }),
    ).resolves.toEqual({
      cursor: undefined,
      receipts: [{ ...receipt, createdAt: 1_700_010, id: 'receipt-2' }, receipt],
    });

    expect(mockRedis.zrem).toHaveBeenCalledWith(
      'agent-signal:receipts:user:user-1:agent:agent-1:topic:topic-1',
      'expired-receipt',
    );
  });

  it('dedupes repeated receipt appends', async () => {
    const store = await loadStore();

    await expect(store.appendReceipt(receipt, 259_200)).resolves.toBe(true);
    await expect(store.appendReceipt(receipt, 259_200)).resolves.toBe(false);
  });

  it('returns an empty page when redis is unavailable', async () => {
    const store = await loadStore();

    (globalThis as AgentSignalRedisTestGlobal).__agentSignalRedisClient = null;

    await expect(
      store.listReceipts({ agentId: 'agent-1', limit: 10, topicId: 'topic-1', userId: 'user-1' }),
    ).resolves.toEqual({ cursor: undefined, receipts: [] });
    await expect(store.appendReceipt(receipt, 259_200)).resolves.toBe(false);
  });
});
