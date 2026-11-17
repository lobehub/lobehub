// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { onSubSessionTurnSettled } from './settle';

const mocks = vi.hoisted(() => ({
  canQueue: vi.fn(() => true),
  deliver: vi.fn(),
  drain: vi.fn(),
  findTopic: vi.fn(),
  labEnabled: vi.fn(),
  queueWakeup: vi.fn(),
}));

vi.mock('./receipt', () => ({ deliverSubSessionReceipt: mocks.deliver }));
vi.mock('./labGate', () => ({ readSubSessionsEnabled: mocks.labEnabled }));
vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn(function () {
    return { findById: mocks.findTopic };
  }),
}));
vi.mock('@/server/services/taskResultBridge/wakeChannel', () => ({
  ResultWakeChannel: Object.assign(
    vi.fn(function () {
      return { drain: mocks.drain, queueWakeup: mocks.queueWakeup };
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

describe('onSubSessionTurnSettled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canQueue.mockReturnValue(true);
    mocks.labEnabled.mockResolvedValue(true);
    mocks.findTopic.mockResolvedValue({ agentId: 'agt_a', id: 'tpc_a' });
    mocks.deliver.mockResolvedValue('delivered');
  });

  it('reports the turn to its opener, then wakes the topic for results that arrived while it ran', async () => {
    await onSubSessionTurnSettled(params, { execAgent: vi.fn() });

    expect(mocks.deliver).toHaveBeenCalledWith(
      { queueWakeup: expect.any(Function) },
      expect.objectContaining({ labEnabled: true, operationId: 'op_1', topicId: 'tpc_a' }),
    );
    expect(mocks.drain).toHaveBeenCalledWith('agt_a', 'tpc_a');
  });

  it('does nothing but read the lab switch while it is off', async () => {
    mocks.labEnabled.mockResolvedValue(false);

    await onSubSessionTurnSettled(params, { execAgent: vi.fn() });

    expect(mocks.deliver).not.toHaveBeenCalled();
    expect(mocks.findTopic).not.toHaveBeenCalled();
    expect(mocks.drain).not.toHaveBeenCalled();
  });

  it('never throws, even when the receipt fails', async () => {
    mocks.deliver.mockRejectedValue(new Error('db down'));

    await expect(onSubSessionTurnSettled(params, { execAgent: vi.fn() })).resolves.toBeUndefined();
    expect(mocks.drain).toHaveBeenCalled();
  });
});
