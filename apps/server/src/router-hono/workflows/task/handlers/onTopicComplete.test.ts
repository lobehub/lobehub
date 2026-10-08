import { beforeEach, describe, expect, it, vi } from 'vitest';

import { onTopicComplete } from './onTopicComplete';

const { getServerDB, isRunAlreadySettled, lifecycleOnTopicComplete } = vi.hoisted(() => ({
  getServerDB: vi.fn(),
  isRunAlreadySettled: vi.fn(),
  lifecycleOnTopicComplete: vi.fn(),
}));

vi.mock('@/database/server', () => ({ getServerDB }));
vi.mock('@/server/services/taskLifecycle', () => ({
  TaskLifecycleService: vi.fn(function () {
    return { onTopicComplete: lifecycleOnTopicComplete };
  }),
}));
vi.mock('@/server/services/taskLifecycle/reconcile', () => ({ isRunAlreadySettled }));

const makeContext = (body: Record<string, unknown>) => {
  const json = vi.fn(function (payload, status = 200) {
    return { payload, status };
  });
  return {
    context: { json, req: { json: vi.fn().mockResolvedValue(body) } } as any,
    json,
  };
};

const failedRunPayload = {
  errorMessage: 'You exceeded your current quota',
  operationId: 'op-1',
  reason: 'error',
  taskId: 'task-1',
  taskIdentifier: 'T-1',
  topicId: 'tpc-1',
  userId: 'user-1',
};

describe('onTopicComplete webhook', () => {
  beforeEach(() => {
    const chain = {
      from: () => chain,
      limit: async () => [{ workspaceId: 'ws-1' }],
      where: () => chain,
    };
    getServerDB.mockReset().mockResolvedValue({ select: () => chain });
    isRunAlreadySettled.mockReset().mockResolvedValue(false);
    lifecycleOnTopicComplete.mockReset().mockResolvedValue(undefined);
  });

  it('drives the lifecycle for a run nobody has settled yet', async () => {
    const { context, json } = makeContext(failedRunPayload);

    await onTopicComplete(context);

    expect(isRunAlreadySettled).toHaveBeenCalledWith(expect.anything(), 'user-1', 'ws-1', {
      operationId: 'op-1',
      reason: 'error',
      taskId: 'task-1',
      topicId: 'tpc-1',
    });
    expect(lifecycleOnTopicComplete).toHaveBeenCalledTimes(1);
    expect(json).toHaveBeenCalledWith({ success: true });
  });

  it('acks a delayed delivery for a run the sweep already settled without re-applying it', async () => {
    isRunAlreadySettled.mockResolvedValue(true);
    const { context, json } = makeContext(failedRunPayload);

    await onTopicComplete(context);

    expect(lifecycleOnTopicComplete).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({ skipped: 'already-settled', success: true });
  });
});
