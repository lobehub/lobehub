// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  scheduleVerifyOnCompletion,
  VERIFY_ON_OPERATION_COMPLETE_PATH,
} from '../completionDispatch';

const { after, deliverWebhook, findByOperation, isQueueMode, runVerifyOnCompletion } = vi.hoisted(
  () => ({
    after: vi.fn(),
    deliverWebhook: vi.fn(),
    findByOperation: vi.fn(),
    isQueueMode: vi.fn(),
    runVerifyOnCompletion: vi.fn(),
  }),
);

vi.mock('@/server/utils/scheduleAfterResponse', () => ({ after }));
vi.mock('@/server/services/agentRuntime/hooks/httpWebhook', () => ({ deliverWebhook }));
vi.mock('@/server/services/queue/impls', () => ({ isQueueAgentRuntimeEnabled: isQueueMode }));
vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(function () {
    return { findByOperation };
  }),
}));
vi.mock('../lifecycle', () => ({ runVerifyOnCompletion }));

const db = {} as any;
const params = { deliverable: 'final reply', goal: 'the task', operationId: 'op-1' };
const confirmedRun = { plan: [{ id: 'c1' }], planConfirmedAt: new Date() };

describe('scheduleVerifyOnCompletion', () => {
  beforeEach(() => {
    [after, deliverWebhook, findByOperation, isQueueMode, runVerifyOnCompletion].forEach((m) =>
      m.mockReset(),
    );
    isQueueMode.mockReturnValue(true);
    findByOperation.mockResolvedValue(confirmedRun);
    deliverWebhook.mockResolvedValue(undefined);
  });

  it('publishes the gate to its own QStash delivery, deduplicated per operation', async () => {
    // A producer that retries its terminal call reaches this once per retry;
    // the deduplication id is what keeps that from starting one gate each.
    await scheduleVerifyOnCompletion(db, 'u1', params, 'ws-1');

    expect(deliverWebhook).toHaveBeenCalledWith(
      { delivery: 'qstash', fallback: 'none', url: VERIFY_ON_OPERATION_COMPLETE_PATH },
      { ...params, userId: 'u1', workspaceId: 'ws-1' },
      { deduplicationId: 'verify-completion:op-1' },
    );
    // Nothing rides the completing request.
    expect(after).not.toHaveBeenCalled();
  });

  it('publishes nothing for a run without a confirmed plan', async () => {
    findByOperation.mockResolvedValue({ plan: [{ id: 'c1' }], planConfirmedAt: null });

    await scheduleVerifyOnCompletion(db, 'u1', params);

    expect(deliverWebhook).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });

  it('judges in-band when the publish fails', async () => {
    deliverWebhook.mockRejectedValue(new Error('qstash down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(scheduleVerifyOnCompletion(db, 'u1', params)).resolves.toBeUndefined();

    expect(after).toHaveBeenCalledTimes(1);
    await after.mock.calls[0][0]();
    expect(runVerifyOnCompletion).toHaveBeenCalledWith(db, 'u1', params, undefined);
  });

  it('stays post-response work without a queue runtime', async () => {
    isQueueMode.mockReturnValue(false);

    await scheduleVerifyOnCompletion(db, 'u1', params);

    expect(deliverWebhook).not.toHaveBeenCalled();
    expect(after).toHaveBeenCalledTimes(1);
    await after.mock.calls[0][0]();
    expect(runVerifyOnCompletion).toHaveBeenCalledWith(db, 'u1', params, undefined);
  });
});
