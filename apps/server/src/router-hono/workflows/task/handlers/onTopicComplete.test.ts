import { beforeEach, describe, expect, it, vi } from 'vitest';

import { onTopicComplete } from './onTopicComplete';

const { claim, getServerDB, isRunAlreadySettled, lifecycleOnTopicComplete, markSettled, release } =
  vi.hoisted(() => ({
    claim: vi.fn(),
    getServerDB: vi.fn(),
    isRunAlreadySettled: vi.fn(),
    lifecycleOnTopicComplete: vi.fn(),
    markSettled: vi.fn(),
    release: vi.fn(),
  }));

vi.mock('@/database/server', () => ({ getServerDB }));
vi.mock('@/server/services/taskLifecycle', () => ({
  TaskLifecycleService: vi.fn(function () {
    return { onTopicComplete: lifecycleOnTopicComplete };
  }),
}));
vi.mock('@/server/services/taskLifecycle/reconcile', () => ({ isRunAlreadySettled }));
vi.mock('@/server/services/redis', () => ({
  redisService: { taskRunDelivery: { claim, markSettled, release } },
}));

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
    claim.mockReset().mockResolvedValue('claimed');
    markSettled.mockReset().mockResolvedValue(undefined);
    release.mockReset().mockResolvedValue(undefined);
  });

  it('drives the lifecycle for a run nobody has settled yet', async () => {
    const { context, json } = makeContext(failedRunPayload);

    await onTopicComplete(context);

    expect(claim).not.toHaveBeenCalled();
    expect(isRunAlreadySettled).toHaveBeenCalledWith(expect.anything(), 'user-1', 'ws-1', {
      operationId: 'op-1',
      reason: 'error',
      taskId: 'task-1',
      topicId: 'tpc-1',
    });
    expect(lifecycleOnTopicComplete).toHaveBeenCalledTimes(1);
    expect(json).toHaveBeenCalledWith({ success: true });
  });

  it('accepts a stable-id-only payload from a newer queue writer', async () => {
    const { taskIdentifier: _legacy, ...payload } = failedRunPayload;
    const { context, json } = makeContext(payload);
    await onTopicComplete(context);
    expect(json).toHaveBeenCalledWith({ success: true });
    expect(lifecycleOnTopicComplete).toHaveBeenCalledTimes(1);
  });

  it('acks a delayed delivery for a run the sweep already settled without re-applying it', async () => {
    isRunAlreadySettled.mockResolvedValue(true);
    const { context, json } = makeContext(failedRunPayload);

    await onTopicComplete(context);

    expect(lifecycleOnTopicComplete).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({ skipped: 'already-settled', success: true });
  });

  describe('a successful run delivered more than once', () => {
    const donePayload = { ...failedRunPayload, errorMessage: undefined, reason: 'done' };

    it('settles the run on the first delivery and remembers it', async () => {
      const { context, json } = makeContext(donePayload);

      await onTopicComplete(context);

      expect(lifecycleOnTopicComplete).toHaveBeenCalledTimes(1);
      expect(markSettled).toHaveBeenCalledWith('op-1');
      expect(json).toHaveBeenCalledWith({ success: true });
    });

    it('acks a redelivery of a settled run without driving the lifecycle again', async () => {
      claim.mockResolvedValue('settled');
      const { context, json } = makeContext(donePayload);

      await onTopicComplete(context);

      expect(lifecycleOnTopicComplete).not.toHaveBeenCalled();
      expect(json).toHaveBeenCalledWith({ skipped: 'already-settled', success: true });
    });

    it('asks QStash to come back while the first delivery is still settling', async () => {
      claim.mockResolvedValue('in-progress');
      const { context, json } = makeContext(donePayload);

      await onTopicComplete(context);

      expect(lifecycleOnTopicComplete).not.toHaveBeenCalled();
      expect(json).toHaveBeenCalledWith({ skipped: 'in-progress' }, 409);
    });

    it('gives the claim back when the settle fails so the retry can finish it', async () => {
      lifecycleOnTopicComplete.mockRejectedValue(new Error('db down'));
      const { context, json } = makeContext(donePayload);

      await onTopicComplete(context);

      expect(release).toHaveBeenCalledWith('op-1');
      expect(markSettled).not.toHaveBeenCalled();
      expect(json).toHaveBeenCalledWith({ error: 'db down' }, 500);
    });

    it('still settles the run when Redis cannot arbitrate', async () => {
      claim.mockResolvedValue('unavailable');
      const { context } = makeContext(donePayload);

      await onTopicComplete(context);

      expect(lifecycleOnTopicComplete).toHaveBeenCalledTimes(1);
    });
  });
});
