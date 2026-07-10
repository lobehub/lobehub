// @vitest-environment node
import type { ExecAgentResult, GatewayQueueContext, GatewayQueuedMessage } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeMessageQueueRedis } from './__tests__/fakeRedis';
import {
  buildGatewayQueueContextKey,
  buildGatewayQueueHandoffReceiptKey,
  buildGatewayQueueOperationKey,
  buildGatewayQueueRedisKeys,
  mergeGatewayQueuedMessages,
  MessageQueueService,
} from './index';

const context: GatewayQueueContext = {
  agentId: 'agent/a',
  scope: 'chat',
  threadId: 'thread:1',
  topicId: 'topic/1',
};

const message = (
  id: string,
  overrides: Partial<GatewayQueuedMessage> = {},
): GatewayQueuedMessage => ({
  createdAt: Number(id.replaceAll(/\D/g, '')) || 1,
  id,
  interruptMode: 'soft',
  prompt: `prompt-${id}`,
  source: 'gateway',
  ...overrides,
});

const operation = (
  operationId: string,
  overrides: Partial<ExecAgentResult> = {},
): ExecAgentResult => ({
  agentId: context.agentId,
  assistantMessageId: `assistant-${operationId}`,
  autoStarted: true,
  createdAt: '2026-07-10T00:00:00.000Z',
  message: 'created',
  operationId,
  status: 'created',
  success: true,
  timestamp: '2026-07-10T00:00:00.000Z',
  topicId: context.topicId,
  userMessageId: `user-${operationId}`,
  ...overrides,
});

describe('MessageQueueService', () => {
  const tenant = { userId: 'user@example.com', workspaceId: 'workspace/1' };
  let redis: FakeMessageQueueRedis;
  let service: MessageQueueService;

  beforeEach(() => {
    redis = new FakeMessageQueueRedis();
    service = new MessageQueueService({
      ...tenant,
      config: {
        activeTtlSec: 101,
        dedupTtlSec: 102,
        handoffTtlSec: 103,
        maxQueueLength: 2,
        queueTtlSec: 104,
        reverseTtlSec: 105,
      },
      redis: redis.asRedis(),
    });
  });

  it('canonicalizes display-only scope aliases into one queue context', () => {
    expect(buildGatewayQueueContextKey(tenant, { ...context, scope: undefined })).toBe(
      buildGatewayQueueContextKey(tenant, { ...context, scope: 'main' }),
    );
  });

  it('atomically claims once, deduplicates the first request, queues, and enforces capacity', async () => {
    const outcomes = await Promise.all([
      service.claimOrEnqueue(context, 'op-1', message('m1')),
      service.claimOrEnqueue(context, 'op-2', message('m2')),
      service.claimOrEnqueue(context, 'op-3', message('m3')),
    ]);

    expect(outcomes.map((result) => result.decision)).toEqual(['proceed', 'queued', 'queued']);
    await expect(service.claimOrEnqueue(context, 'op-4', message('m1'))).resolves.toMatchObject({
      activeOperationId: 'op-1',
      decision: 'duplicate',
    });
    await expect(service.claimOrEnqueue(context, 'op-5', message('m4'))).resolves.toMatchObject({
      activeOperationId: 'op-1',
      decision: 'rejected',
    });

    const contextKey = buildGatewayQueueContextKey(tenant, context);
    const keys = buildGatewayQueueRedisKeys(contextKey);
    expect(redis.strings.get(keys.active)).toBe('op-1');
    expect(redis.expiries.get(keys.active)).toBe(101);
    expect(redis.expiries.get(keys.queue)).toBe(104);
    expect(redis.expiries.get(keys.dedup)).toBe(102);
    expect(redis.expiries.get(buildGatewayQueueOperationKey(tenant, 'op-1'))).toBe(105);
    expect((await service.peek(context)).items.map((item) => item.id)).toEqual(['m2', 'm3']);

    const firstEval = redis.evalCalls[0];
    expect(firstEval.keys).toEqual([
      keys.active,
      keys.queue,
      keys.dedup,
      buildGatewayQueueOperationKey(tenant, 'op-1'),
      keys.context,
      keys.inflight,
      keys.handoffPointer,
    ]);
    expect(firstEval.args.slice(5)).toEqual([2, 101, 104, 102, 105]);
  });

  it('conditionally inspects ownership and refreshes the operation lease', async () => {
    await service.claimOrEnqueue(context, 'op-owner', message('m1'));
    await service.claimOrEnqueue(context, 'ignored', message('m2'));

    await expect(service.inspectAndRefresh('op-owner')).resolves.toEqual({
      context,
      hasPending: true,
    });
    await expect(service.inspectAndRefresh('not-owner')).resolves.toBeNull();

    const keys = buildGatewayQueueRedisKeys(buildGatewayQueueContextKey(tenant, context));
    redis.strings.set(keys.active, 'replacement-owner');
    await expect(service.inspectAndRefresh('op-owner')).resolves.toBeNull();
    expect(redis.strings.get(keys.active)).toBe('replacement-owner');
  });

  it('transfers a parked owner to its resume operation and can reclaim after release', async () => {
    await service.claimOrEnqueue(context, 'op-parked', message('m0'));
    await service.claimOrEnqueue(context, 'ignored', message('m1'));

    await expect(service.adoptOwnership(context, 'op-resume', 'op-parked')).resolves.toBe(true);
    await expect(service.inspectAndRefresh('op-parked')).resolves.toBeNull();
    await expect(service.inspectAndRefresh('op-resume')).resolves.toMatchObject({
      hasPending: true,
    });

    await service.releaseOwned('op-resume');
    await expect(service.adoptOwnership(context, 'op-resume-2', 'op-resume')).resolves.toBe(true);
    await expect(service.inspectAndRefresh('op-resume-2')).resolves.toMatchObject({
      hasPending: true,
    });
  });

  it('hands off without an unlocked window and retries with the first actual next operation', async () => {
    await service.claimOrEnqueue(context, 'op-old', message('m0'));
    await service.claimOrEnqueue(context, 'ignored-1', message('m1'));
    await service.claimOrEnqueue(context, 'ignored-2', message('m2'));

    const first = await service.beginHandoff('op-old', 'op-next');
    expect(first).toMatchObject({
      consumedQueueIds: ['m1', 'm2'],
      nextOperationId: 'op-next',
      oldOperationId: 'op-old',
      status: 'pending',
    });
    expect(first?.items.map((item) => item.id)).toEqual(['m1', 'm2']);

    await expect(
      service.claimOrEnqueue(context, 'op-racing', message('m3')),
    ).resolves.toMatchObject({ activeOperationId: 'op-next', decision: 'queued' });

    const retry = await service.beginHandoff('op-old', 'different-proposal');
    expect(retry?.nextOperationId).toBe('op-next');
    expect(retry?.items.map((item) => item.id)).toEqual(['m1', 'm2']);

    const nextOperation = operation('op-next');
    await expect(service.commitHandoff('op-old', nextOperation)).resolves.toBe(true);
    await expect(service.getHandoffReceipt('op-old')).resolves.toMatchObject({
      consumedQueueIds: ['m1', 'm2'],
      nextOperation,
      nextOperationId: 'op-next',
      status: 'committed',
    });

    const committedRetry = await service.beginHandoff('op-old', 'another-proposal');
    expect(committedRetry).toMatchObject({
      items: [],
      nextOperation,
      nextOperationId: 'op-next',
      status: 'committed',
    });
    expect((await service.peek(context)).items.map((item) => item.id)).toEqual(['m3']);

    const receiptKey = buildGatewayQueueHandoffReceiptKey(tenant, 'op-old');
    expect(redis.expiries.get(receiptKey)).toBe(103);
  });

  it('finalizes a failed persisted next turn without restoring consumed rows', async () => {
    await service.claimOrEnqueue(context, 'op-old', message('m0'));
    await service.claimOrEnqueue(context, 'ignored', message('m1'));
    await service.beginHandoff('op-old', 'op-next');
    await service.claimOrEnqueue(context, 'ignored-new', message('m2'));

    const failed = operation('op-next', {
      error: 'startup failed',
      status: 'error',
      success: false,
    });
    await expect(service.failHandoff('op-old', failed)).resolves.toBe(true);
    await expect(service.getHandoffReceipt('op-old')).resolves.toMatchObject({
      nextOperation: failed,
      status: 'failed',
    });

    const keys = buildGatewayQueueRedisKeys(buildGatewayQueueContextKey(tenant, context));
    expect(redis.strings.get(keys.active)).toBeUndefined();
    expect(redis.lists.get(keys.inflight)).toBeUndefined();
    expect((await service.peek(context)).items.map((item) => item.id)).toEqual(['m2']);
  });

  it('rolls an unconsumed snapshot back ahead of messages received during handoff', async () => {
    await service.claimOrEnqueue(context, 'op-old', message('m0'));
    await service.claimOrEnqueue(context, 'ignored-1', message('m1'));
    await service.claimOrEnqueue(context, 'ignored-2', message('m2'));
    await service.beginHandoff('op-old', 'op-next');
    await service.claimOrEnqueue(context, 'ignored-3', message('m3'));

    await expect(service.rollbackHandoff('op-old', 'op-next')).resolves.toBe(true);
    expect((await service.peek(context)).items.map((item) => item.id)).toEqual(['m1', 'm2', 'm3']);
    await expect(service.getHandoffReceipt('op-old')).resolves.toMatchObject({
      status: 'rolled_back',
    });
  });

  it('atomically recovers an idle backlog without letting the kick request jump the queue', async () => {
    await service.claimOrEnqueue(context, 'op-old', message('m0'));
    await service.claimOrEnqueue(context, 'ignored-1', message('m1'));
    await service.claimOrEnqueue(context, 'ignored-2', message('m2'));
    await service.beginHandoff('op-old', 'op-failed');
    await service.rollbackHandoff('op-old', 'op-failed');

    const recovered = await service.claimOrEnqueue(context, 'op-recovery', message('m3'));
    expect(recovered).toMatchObject({
      decision: 'proceed',
      recoveredItems: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }],
    });
    expect((await service.peek(context)).items).toEqual([]);

    // A startup failure restores the whole reservation. Retrying the same
    // request id reserves it again without appending a duplicate m3.
    await service.releaseOwned('op-recovery', { dedupId: 'm3', preserveQueue: true });
    const retry = await service.claimOrEnqueue(context, 'op-retry', message('m3'));
    expect(retry.recoveredItems?.map((item) => item.id)).toEqual(['m1', 'm2', 'm3']);
    await expect(service.commitRecoveredClaim('op-retry')).resolves.toBe(true);

    const keys = buildGatewayQueueRedisKeys(buildGatewayQueueContextKey(tenant, context));
    expect(redis.lists.get(keys.inflight)).toBeUndefined();
  });

  it('uses owner CAS when releasing and preserves pending rows by default', async () => {
    await service.claimOrEnqueue(context, 'op-owner', message('m0'));
    await service.claimOrEnqueue(context, 'ignored', message('m1'));
    const keys = buildGatewayQueueRedisKeys(buildGatewayQueueContextKey(tenant, context));

    redis.strings.set(keys.active, 'new-owner');
    await expect(service.releaseOwned('op-owner')).resolves.toBe(false);
    expect(redis.strings.get(keys.active)).toBe('new-owner');

    redis.strings.set(keys.active, 'op-owner');
    await expect(service.releaseOwned('op-owner')).resolves.toBe(true);
    expect(redis.strings.get(keys.active)).toBeUndefined();
    expect((await service.peek(context)).items.map((item) => item.id)).toEqual(['m1']);
  });

  it('removes the claim dedup id when startup releases before an operation exists', async () => {
    await service.claimOrEnqueue(context, 'op-owner', message('request-retry'));

    await expect(
      service.releaseOwned('op-owner', { dedupId: 'request-retry', preserveQueue: true }),
    ).resolves.toBe(true);
    await expect(
      service.claimOrEnqueue(context, 'op-retry', message('request-retry')),
    ).resolves.toMatchObject({ decision: 'proceed' });
  });

  it('consumes a durable recovered batch and keeps its request id deduplicated', async () => {
    await service.claimOrEnqueue(context, 'op-old', message('m0'));
    await service.claimOrEnqueue(context, 'ignored', message('m1'));
    await service.releaseOwned('op-old');

    const recovered = await service.claimOrEnqueue(context, 'op-recovery', message('m2'));
    expect(recovered.recoveredItems?.map((item) => item.id)).toEqual(['m1', 'm2']);
    await expect(service.commitRecoveredClaim('op-recovery')).resolves.toBe(true);
    await expect(
      service.releaseOwned('op-recovery', {
        dedupId: 'm2',
        preserveQueue: true,
        recoveredBatchPersisted: true,
      }),
    ).resolves.toBe(true);

    await expect(service.claimOrEnqueue(context, 'op-retry', message('m2'))).resolves.toMatchObject(
      {
        activeOperationId: '',
        decision: 'duplicate',
      },
    );
    await expect(service.peek(context)).resolves.toEqual({ activeOperationId: null, items: [] });
  });

  it('peeks, updates, removes, and clears queued messages', async () => {
    await service.claimOrEnqueue(context, 'op-owner', message('m0'));
    await service.claimOrEnqueue(context, 'ignored', message('m1'));

    await expect(
      service.update(context, 'm1', {
        editorData: { root: { type: 'root' } },
        metadata: { collapsed: true },
        prompt: 'edited',
      }),
    ).resolves.toMatchObject({
      item: { id: 'm1', prompt: 'edited' },
      updated: true,
    });
    await expect(service.update(context, 'missing', { prompt: 'nope' })).resolves.toEqual({
      item: null,
      updated: false,
    });
    await expect(service.remove(context, 'm1')).resolves.toEqual({
      queueId: 'm1',
      removed: true,
    });
    await expect(service.remove(context, 'm1')).resolves.toEqual({
      queueId: 'm1',
      removed: false,
    });

    await service.cancelAndClear(context);
    await expect(service.peek(context)).resolves.toEqual({ activeOperationId: null, items: [] });
  });

  it('rejects malformed Lua payloads instead of treating them as a queue decision', async () => {
    vi.spyOn(redis, 'eval').mockResolvedValueOnce('{not-json');

    await expect(service.claimOrEnqueue(context, 'op-owner', message('m1'))).rejects.toThrow(
      'invalid enqueue result',
    );
  });
});

describe('mergeGatewayQueuedMessages', () => {
  it('sorts prompts, deduplicates files/tools, retains consumed ids, and uses latest context fields', () => {
    const merged = mergeGatewayQueuedMessages([
      message('m2', {
        appContext: { scope: 'latest', topicId: context.topicId },
        createdAt: 20,
        deviceId: 'device-latest',
        editorData: {
          root: {
            children: [{ text: 'rich second', type: 'text' }],
            type: 'root',
            version: 1,
          },
        },
        fileIds: ['file-a', 'file-b'],
        filesPreview: [{ id: 'file-a', mimeType: 'image/png', name: 'new.png', url: 'new' }],
        mentionedAgents: [{ id: 'agent-b', name: 'B' }],
        metadata: {
          collapsed: true,
          pageSelections: [{ content: 'second', id: 'selection-2', pageId: 'page-2' }],
        },
        selectedToolIds: ['tool-a', 'tool-b'],
      }),
      message('m1', {
        createdAt: 10,
        fileIds: ['file-a'],
        filesPreview: [{ id: 'file-a', mimeType: 'image/png', name: 'old.png', url: 'old' }],
        mentionedAgents: [{ id: 'agent-a', name: 'A' }],
        metadata: {
          inspectExpanded: true,
          pageSelections: [{ content: 'first', id: 'selection-1', pageId: 'page-1' }],
        },
        selectedToolIds: ['tool-a'],
      }),
    ]);

    expect(merged).toMatchObject({
      appContext: { scope: 'latest', topicId: context.topicId },
      consumedQueueIds: ['m1', 'm2'],
      deviceId: 'device-latest',
      fileIds: ['file-a', 'file-b'],
      mentionedAgents: [
        { id: 'agent-a', name: 'A' },
        { id: 'agent-b', name: 'B' },
      ],
      prompt: 'prompt-m1\n\nprompt-m2',
      selectedToolIds: ['tool-a', 'tool-b'],
    });
    expect(merged?.editorData).toMatchObject({
      root: {
        children: [
          { children: [{ text: 'prompt-m1' }] },
          { children: [] },
          { text: 'rich second' },
        ],
      },
    });
    expect(merged?.metadata).toMatchObject({
      collapsed: true,
      inspectExpanded: true,
      pageSelections: [
        { content: 'first', pageId: 'page-1' },
        { content: 'second', pageId: 'page-2' },
      ],
    });
    expect(merged?.filesPreview).toEqual([
      { id: 'file-a', mimeType: 'image/png', name: 'new.png', url: 'new' },
    ]);
    expect(mergeGatewayQueuedMessages([])).toBeNull();
  });
});
