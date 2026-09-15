// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TopicModel } from '@/database/models/topic';

import { acquireTopicStartReservation } from './topicStartReservation';

describe('acquireTopicStartReservation', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries with bounded exponential backoff and then fails for workflow redelivery', async () => {
    vi.useFakeTimers();
    const tryReserveTaskCallback = vi.fn().mockResolvedValue(false);
    const topicModel = { tryReserveTaskCallback } as unknown as TopicModel;

    const reservation = acquireTopicStartReservation({
      reservationId: 'callback-1',
      topicId: 'topic-1',
      topicModel,
    });
    const expectation = expect(reservation).rejects.toThrow('Topic topic-1 remained busy');

    await vi.runAllTimersAsync();
    await expectation;

    expect(tryReserveTaskCallback).toHaveBeenCalledTimes(6);
  });

  it('returns false when the topic no longer exists', async () => {
    const topicModel = {
      tryReserveTaskCallback: vi.fn().mockResolvedValue(null),
    } as unknown as TopicModel;

    await expect(
      acquireTopicStartReservation({
        reservationId: 'callback-1',
        topicId: 'topic-1',
        topicModel,
      }),
    ).resolves.toBe(false);
  });

  it('forwards the operation id used for an atomic topic handoff', async () => {
    const tryReserveTaskCallback = vi.fn().mockResolvedValue(true);
    const topicModel = { tryReserveTaskCallback } as unknown as TopicModel;

    await acquireTopicStartReservation({
      replacesOperationId: 'old-operation',
      reservationId: 'new-start',
      topicId: 'topic-1',
      topicModel,
    });

    expect(tryReserveTaskCallback).toHaveBeenCalledWith('topic-1', 'new-start', {
      allowRunningOperationId: undefined,
      allowSameReservationReentry: undefined,
      ignoreRunningOperation: undefined,
      replacesOperationId: 'old-operation',
    });
  });

  it('passes the parent operation ownership through for in-group children', async () => {
    const tryReserveTaskCallback = vi.fn().mockResolvedValue(true);
    const topicModel = { tryReserveTaskCallback } as unknown as TopicModel;

    await expect(
      acquireTopicStartReservation({
        allowRunningOperationId: 'parent-operation',
        reservationId: 'child-operation',
        topicId: 'topic-1',
        topicModel,
      }),
    ).resolves.toBe(true);

    expect(tryReserveTaskCallback).toHaveBeenCalledWith('topic-1', 'child-operation', {
      allowRunningOperationId: 'parent-operation',
      allowSameReservationReentry: undefined,
      ignoreRunningOperation: undefined,
      replacesOperationId: undefined,
    });
  });

  it('forwards the interactive bypass so a composer send never waits on a run', async () => {
    const tryReserveTaskCallback = vi.fn().mockResolvedValue(true);
    const topicModel = { tryReserveTaskCallback } as unknown as TopicModel;

    await acquireTopicStartReservation({
      ignoreRunningOperation: true,
      reservationId: 'composer-send',
      topicId: 'topic-1',
      topicModel,
    });

    expect(tryReserveTaskCallback).toHaveBeenCalledWith('topic-1', 'composer-send', {
      allowRunningOperationId: undefined,
      allowSameReservationReentry: undefined,
      ignoreRunningOperation: true,
      replacesOperationId: undefined,
    });
  });

  it('forwards the non-reentrant intervention initializer fence', async () => {
    const tryReserveTaskCallback = vi.fn().mockResolvedValue(true);
    const topicModel = { tryReserveTaskCallback } as unknown as TopicModel;

    await acquireTopicStartReservation({
      allowSameReservationReentry: false,
      ignoreRunningOperation: true,
      reservationId: 'op-intervention',
      topicId: 'topic-1',
      topicModel,
    });

    expect(tryReserveTaskCallback).toHaveBeenCalledWith('topic-1', 'op-intervention', {
      allowRunningOperationId: undefined,
      allowSameReservationReentry: false,
      ignoreRunningOperation: true,
      replacesOperationId: undefined,
    });
  });
});
