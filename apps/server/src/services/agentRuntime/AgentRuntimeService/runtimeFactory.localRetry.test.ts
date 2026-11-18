// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalQueueServiceImpl } from '@/server/services/queue/impls';

import { DurableStatusUnavailableError } from './executionErrors';
import {
  LOCAL_DURABLE_STATUS_RETRY_DELAYS_MS,
  type RuntimeFactoryDeps,
  setupLocalExecutionCallback,
} from './runtimeFactory';

const captureCallback = (executeStep: ReturnType<typeof vi.fn>) => {
  const impl = new LocalQueueServiceImpl();
  const setCallback = vi.spyOn(impl, 'setExecutionCallback');
  setupLocalExecutionCallback({
    executeStep,
    queueService: { getImpl: () => impl },
  } as unknown as RuntimeFactoryDeps);
  return setCallback.mock.calls[0][0];
};

const unavailable = () => new DurableStatusUnavailableError('op-1', 0);

describe('local delivery of a step that refused an unreadable durable status', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries the step once the status can be read again', async () => {
    const executeStep = vi
      .fn()
      .mockRejectedValueOnce(unavailable())
      .mockResolvedValueOnce({ success: true });
    const callback = captureCallback(executeStep);

    const delivery = callback('op-1', 0, { phase: 'user_input' }, { approvedToolCall: 'call-1' });
    await vi.advanceTimersByTimeAsync(LOCAL_DURABLE_STATUS_RETRY_DELAYS_MS[0]);
    await delivery;

    expect(executeStep).toHaveBeenCalledTimes(2);
    expect(executeStep).toHaveBeenLastCalledWith({
      approvedToolCall: 'call-1',
      context: { phase: 'user_input' },
      operationId: 'op-1',
      stepIndex: 0,
    });
  });

  it('gives up after the retry budget, like an exhausted queue redelivery', async () => {
    const executeStep = vi.fn().mockRejectedValue(unavailable());
    const callback = captureCallback(executeStep);

    const delivery = expect(callback('op-1', 0, {}, undefined)).rejects.toBeInstanceOf(
      DurableStatusUnavailableError,
    );
    for (const delay of LOCAL_DURABLE_STATUS_RETRY_DELAYS_MS) {
      await vi.advanceTimersByTimeAsync(delay);
    }
    await delivery;

    expect(executeStep).toHaveBeenCalledTimes(LOCAL_DURABLE_STATUS_RETRY_DELAYS_MS.length + 1);
  });

  it('does not retry other step failures', async () => {
    const failure = new Error('model failed');
    const executeStep = vi.fn().mockRejectedValue(failure);
    const callback = captureCallback(executeStep);

    await expect(callback('op-1', 0, {}, undefined)).rejects.toBe(failure);
    expect(executeStep).toHaveBeenCalledTimes(1);
  });
});
