// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { onSubTopicTurnSettled } from './settle';

const mocks = vi.hoisted(() => ({
  canQueue: vi.fn(() => true),
  deliver: vi.fn(),
  drainIfPending: vi.fn(),
  findTopic: vi.fn(),
  queueWakeup: vi.fn(),
}));

vi.mock('./receipt', () => ({
  SUB_TOPIC_RECEIPT_PREFIX: 'subtopic-cb-',
  deliverSubTopicReceipt: mocks.deliver,
}));
vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn(function () {
    return { findById: mocks.findTopic };
  }),
}));
vi.mock('@/server/services/taskResultBridge/wakeChannel', () => ({
  ResultWakeChannel: Object.assign(
    vi.fn(function () {
      return { drainIfPending: mocks.drainIfPending, queueWakeup: mocks.queueWakeup };
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
      { queueWakeup: expect.any(Function) },
      expect.objectContaining({ operationId: 'op_1', topicId: 'tpc_a' }),
    );
    // Only sub-topic receipts pull the wake forward; task callbacks keep their timing.
    expect(mocks.drainIfPending).toHaveBeenCalledWith('agt_a', 'tpc_a', 'subtopic-cb-');
  });

  it('never throws, even when the receipt fails', async () => {
    mocks.deliver.mockRejectedValue(new Error('db down'));

    await expect(onSubTopicTurnSettled(params, { execAgent: vi.fn() })).resolves.toBeUndefined();
    expect(mocks.drainIfPending).toHaveBeenCalled();
  });
});
