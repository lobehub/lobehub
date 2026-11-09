// @vitest-environment node
import type { Client } from '@upstash/qstash';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QStashGoalScheduler } from './qstash';

const publishJSON = vi.fn().mockResolvedValue({ messageId: 'msg' });
const scheduler = new QStashGoalScheduler({
  baseUrl: 'https://app.test/',
  qstashClient: { publishJSON } as unknown as Client,
});
const params = { goalId: 'goal_a', userId: 'user' };
const sentId = (call: number) => publishJSON.mock.calls[call][0].deduplicationId;

describe('QStashGoalScheduler', () => {
  beforeEach(() => {
    publishJSON.mockClear();
    vi.useFakeTimers({ now: 1_000_000 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('collapses delayed advances of one goal that land on the same moment', async () => {
    await scheduler.scheduleAdvance({ ...params, delay: 5 });
    vi.advanceTimersByTime(1000);
    await scheduler.scheduleAdvance({ ...params, delay: 5 });

    expect(sentId(0)).toBeDefined();
    expect(sentId(1)).toBe(sentId(0));
  });

  it('keeps a polling chain alive: the next poll is a different message', async () => {
    await scheduler.scheduleAdvance({ ...params, delay: 5 });
    vi.advanceTimersByTime(5000);
    await scheduler.scheduleAdvance({ ...params, delay: 5 });

    expect(sentId(1)).not.toBe(sentId(0));
  });

  it('does not collapse delayed advances of different goals', async () => {
    await scheduler.scheduleAdvance({ ...params, delay: 5 });
    await scheduler.scheduleAdvance({ ...params, delay: 5, goalId: 'goal_b' });

    expect(sentId(1)).not.toBe(sentId(0));
  });

  it('never collapses an immediate advance, which reports a new event', async () => {
    await scheduler.scheduleAdvance(params);

    expect(publishJSON.mock.calls[0][0]).not.toHaveProperty('deduplicationId');
  });
});
