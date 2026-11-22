// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { onAbandonedSubTopicRun, onSubTopicTurnSettled } from './settle';

const mocks = vi.hoisted(() => ({
  canQueue: vi.fn(() => true),
  createPending: vi.fn(),
  redisStore: vi.fn(),
  deliver: vi.fn(),
  drainIfPending: vi.fn(),
  findOperation: vi.fn(),
  findTopic: vi.fn(),
  listReceiptsSince: vi.fn(),
  queueWakeup: vi.fn(),
  wakeDirect: vi.fn(),
}));

vi.mock('./receipt', () => ({
  SUB_TOPIC_RECEIPT_PREFIX: 'subtopic-cb-',
  deliverSubTopicReceipt: mocks.deliver,
  listReceiptsSince: mocks.listReceiptsSince,
}));
vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn(function () {
    return { findById: mocks.findOperation };
  }),
}));
vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn(function () {
    return { findById: mocks.findTopic };
  }),
}));
vi.mock('@/server/services/taskResultBridge/redisStore', () => ({
  TaskResultCallbackRedisStore: vi.fn(function (...args: unknown[]) {
    mocks.redisStore(...args);
    return { createPending: mocks.createPending };
  }),
}));
vi.mock('@/server/services/taskResultBridge/wakeChannel', () => ({
  ResultWakeChannel: Object.assign(
    vi.fn(function () {
      return {
        drainIfPending: mocks.drainIfPending,
        queueWakeup: mocks.queueWakeup,
        wakeDirect: mocks.wakeDirect,
      };
    }),
    { canQueue: mocks.canQueue },
  ),
}));

const params = {
  db: {} as any,
  operationId: 'op_1',
  reason: 'done',
  topicId: 'tpc_a',
  userId: 'user-1',
};

describe('onSubTopicTurnSettled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canQueue.mockReturnValue(true);
    mocks.findTopic.mockResolvedValue({ agentId: 'agt_a', id: 'tpc_a' });
    mocks.deliver.mockResolvedValue('delivered');
  });

  it('reports the turn to its opener, then wakes the topic for results that arrived while it ran', async () => {
    await onSubTopicTurnSettled(params, { execAgent: vi.fn() });

    expect(mocks.deliver).toHaveBeenCalledWith(
      // `canQueue` lets a redelivered completion re-queue a wake that failed to enqueue.
      { canQueue: expect.any(Function), queueWakeup: expect.any(Function) },
      expect.objectContaining({ operationId: 'op_1', topicId: 'tpc_a' }),
    );
    // Only sub-topic receipts pull the wake forward; task callbacks keep their timing.
    expect(mocks.drainIfPending).toHaveBeenCalledWith('agt_a', 'tpc_a', 'subtopic-cb-');
  });

  it('without the queue, wakes the topic once for receipts that landed while this run held it', async () => {
    mocks.canQueue.mockReturnValue(false);
    const startedAt = new Date('2026-11-18T00:00:00.000Z');
    mocks.findOperation.mockResolvedValue({ createdAt: startedAt, id: 'op_1' });
    mocks.listReceiptsSince.mockResolvedValue(['subtopic-cb-op_x', 'subtopic-cb-op_y']);

    await onSubTopicTurnSettled(params, { execAgent: vi.fn() });

    expect(mocks.listReceiptsSince).toHaveBeenCalledWith(params.db, 'tpc_a', startedAt);
    expect(mocks.wakeDirect).toHaveBeenCalledWith({
      agentId: 'agt_a',
      originTopicId: 'tpc_a',
      receiptIds: ['subtopic-cb-op_x', 'subtopic-cb-op_y'],
    });
    expect(mocks.drainIfPending).not.toHaveBeenCalled();
  });

  it('never throws, even when the receipt fails', async () => {
    mocks.deliver.mockRejectedValue(new Error('db down'));

    await expect(onSubTopicTurnSettled(params, { execAgent: vi.fn() })).resolves.toBeUndefined();
    expect(mocks.drainIfPending).toHaveBeenCalled();
  });
});

describe('onAbandonedSubTopicRun', () => {
  const abandoned = { ...params, reason: 'inactivity_watchdog', workspaceId: 'ws-1' };
  const queuedWake = () => mocks.deliver.mock.calls[0][0].queueWakeup;
  const wake = {
    agentId: 'agt_p',
    callbackMessageId: 'msg_cb',
    originTopicId: 'tpc_p',
    receiptId: 'subtopic-cb-op_1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canQueue.mockReturnValue(true);
    mocks.deliver.mockResolvedValue('delivered');
  });

  it('reports the run to its opener as failed, with why it ended', async () => {
    await onAbandonedSubTopicRun(abandoned);

    expect(mocks.deliver).toHaveBeenCalledWith(
      { canQueue: expect.any(Function), queueWakeup: expect.any(Function) },
      expect.objectContaining({
        errorMessage: expect.stringContaining('inactivity_watchdog'),
        operationId: 'op_1',
        reason: 'error',
        topicId: 'tpc_a',
        userId: 'user-1',
        workspaceId: 'ws-1',
      }),
    );
  });

  it("queues the parent's wake for the recovery sweep instead of starting a run", async () => {
    await onAbandonedSubTopicRun(abandoned);
    await queuedWake()(wake);

    expect(mocks.redisStore).toHaveBeenCalledWith('user-1', 'tpc_p', 'ws-1');
    expect(mocks.createPending).toHaveBeenCalledWith({
      agentId: 'agt_p',
      callbackMessageId: 'msg_cb',
      operationId: 'subtopic-cb-op_1',
    });
    expect(mocks.drainIfPending).not.toHaveBeenCalled();
    expect(mocks.wakeDirect).not.toHaveBeenCalled();
  });

  it('without the queue, leaves the receipt on the main line for the next turn', async () => {
    mocks.canQueue.mockReturnValue(false);

    await onAbandonedSubTopicRun(abandoned);
    await queuedWake()(wake);

    expect(mocks.createPending).not.toHaveBeenCalled();
  });

  it('never throws', async () => {
    mocks.deliver.mockRejectedValue(new Error('db down'));

    await expect(onAbandonedSubTopicRun(abandoned)).resolves.toBeUndefined();
  });
});
