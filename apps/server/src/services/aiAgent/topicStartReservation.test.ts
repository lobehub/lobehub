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
});
