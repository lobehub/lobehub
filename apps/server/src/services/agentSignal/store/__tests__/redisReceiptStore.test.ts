// @vitest-environment node
import { LayersEnum } from '@lobechat/types';
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
    id: 'preference-1',
    memoryId: 'memory-1',
    memoryLayer: LayersEnum.Preference,
    summary: 'Use short answers in future chats',
    title: 'Short answer preference',
    type: 'memory' as const,
  },
  title: 'Memory saved',
  topicId: 'topic-1',
  triggerMessageId: 'user-message-1',
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
        id: 'preference-1',
        memoryId: 'memory-1',
        memoryLayer: LayersEnum.Preference,
        summary: 'Use short answers in future chats',
        title: 'Short answer preference',
        type: 'memory',
      }),
      title: 'Memory saved',
      topicId: 'topic-1',
      triggerMessageId: 'user-message-1',
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

  it('round-trips skill receipt target document refs', async () => {
    const store = await loadStore();
    const skillReceipt = {
      ...receipt,
      detail: 'Improved how this assistant handles similar requests',
      id: 'receipt-skill-1',
      kind: 'skill' as const,
      status: 'updated' as const,
      target: {
        agentDocumentId: 'index-agent-document-1',
        documentId: 'index-document-1',
        id: 'bundle-document-1',
        summary: 'Review metadata, diff, blockers, and merge status.',
        title: 'GitHub PR review workflow',
        type: 'skill' as const,
      },
      title: 'Skill updated',
    };

    await store.appendReceipt(skillReceipt, 259_200);

    await expect(
      store.listReceipts({ agentId: 'agent-1', limit: 10, topicId: 'topic-1', userId: 'user-1' }),
    ).resolves.toMatchObject({
      receipts: [
        {
          target: {
            agentDocumentId: 'index-agent-document-1',
            documentId: 'index-document-1',
            id: 'bundle-document-1',
            title: 'GitHub PR review workflow',
            type: 'skill',
          },
        },
      ],
    });
  });

  it('round-trips triggerMessageId with the receipt payload', async () => {
    const store = await loadStore();

    await store.appendReceipt(receipt, 259_200);

    await expect(
      store.listReceipts({ agentId: 'agent-1', limit: 10, topicId: 'topic-1', userId: 'user-1' }),
    ).resolves.toMatchObject({
      receipts: [
        {
          anchorMessageId: 'assistant-1',
          triggerMessageId: 'user-message-1',
        },
      ],
    });
  });

  it('updates persisted receipt metadata so refetches reuse the terminal rollback status', async () => {
    const store = await loadStore();

    await store.appendReceipt(
      {
        ...receipt,
        id: 'receipt-skill-rollback-1',
        kind: 'skill',
        metadata: {
          documentId: 'doc-1',
          expectedCurrentDocumentUpdatedAt: '2026-06-29T00:00:00.000Z',
          historyId: 'history-1',
          rollbackStatus: 'available',
        },
        status: 'updated',
      },
      259_200,
    );

    await store.updateReceiptMetadata?.('receipt-skill-rollback-1', {
      documentId: 'doc-1',
      expectedCurrentDocumentUpdatedAt: '2026-06-29T00:00:00.000Z',
      historyId: 'history-1',
      rollbackStatus: 'rolled_back',
    });

    await expect(store.getReceipt?.('receipt-skill-rollback-1')).resolves.toMatchObject({
      metadata: {
        documentId: 'doc-1',
        expectedCurrentDocumentUpdatedAt: '2026-06-29T00:00:00.000Z',
        historyId: 'history-1',
        rollbackStatus: 'rolled_back',
      },
    });
  });

  it('lists receipts created after a known timestamp for refresh polling', async () => {
    const store = await loadStore();

    await store.appendReceipt(receipt, 259_200);
    await store.appendReceipt({ ...receipt, createdAt: 1_700_010, id: 'receipt-2' }, 259_200);
    await store.appendReceipt({ ...receipt, createdAt: 1_700_020, id: 'receipt-3' }, 259_200);

    await expect(
      store.listReceipts({
        agentId: 'agent-1',
        limit: 10,
        sinceCreatedAt: 1_700_010,
        topicId: 'topic-1',
        userId: 'user-1',
      }),
    ).resolves.toEqual({
      cursor: undefined,
      receipts: [{ ...receipt, createdAt: 1_700_020, id: 'receipt-3' }],
    });

    expect(mockRedis.zrange).toHaveBeenCalledWith(
      'agent-signal:receipts:user:user-1:agent:agent-1:topic:topic-1',
      '+inf',
      '(1700010',
      'BYSCORE',
      'REV',
      'LIMIT',
      0,
      11,
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
