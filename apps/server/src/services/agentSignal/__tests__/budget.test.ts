// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { acquireAgentSignalDailyBudget, describeBudgetDenial, toUtcDay } from '../budget';
import { AGENT_SIGNAL_DEFAULTS } from '../constants';

const service = vi.hoisted(() => ({
  available: true,
  countClassifierCall: vi.fn(),
  counters: new Map<string, number>(),
}));

vi.mock('@/server/services/redis', () => ({
  redisService: { agentSignal: { countClassifierCall: service.countClassifierCall } },
}));

const NOW = Date.UTC(2026, 9, 11, 23, 30);

describe('acquireAgentSignalDailyBudget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.available = true;
    service.counters.clear();
    service.countClassifierCall.mockImplementation(
      async ({ userId, utcDay }: { userId: string; utcDay: string }) => {
        if (!service.available) return undefined;
        const key = `${userId}:${utcDay}`;
        const next = (service.counters.get(key) ?? 0) + 1;
        service.counters.set(key, next);
        return next;
      },
    );
  });

  /**
   * @example
   * Call 200 of the day is allowed; call 201 is denied with an `exceeded` reason.
   */
  it('allows classifier calls up to the daily limit and denies the next one', async () => {
    const limit = AGENT_SIGNAL_DEFAULTS.dailyFeedbackClassifierBudgetPerUser;
    service.counters.set('u1:2026-10-11', limit - 1);

    await expect(
      acquireAgentSignalDailyBudget({ kind: 'feedback-classifier', now: NOW, userId: 'u1' }),
    ).resolves.toEqual({ allowed: true, count: limit, kind: 'feedback-classifier', limit: 200 });
    await expect(
      acquireAgentSignalDailyBudget({ kind: 'feedback-classifier', now: NOW, userId: 'u1' }),
    ).resolves.toEqual({
      allowed: false,
      count: limit + 1,
      kind: 'feedback-classifier',
      limit,
      reason: 'exceeded',
    });
    expect(service.countClassifierCall).toHaveBeenCalledWith({
      userId: 'u1',
      utcDay: '2026-10-11',
    });
  });

  /**
   * @example
   * Budgets are per user and per UTC day.
   */
  it('keeps separate counters per user and UTC day', async () => {
    service.counters.set('u1:2026-10-11', 1000);

    await expect(
      acquireAgentSignalDailyBudget({ kind: 'feedback-classifier', now: NOW, userId: 'u2' }),
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      acquireAgentSignalDailyBudget({
        kind: 'feedback-classifier',
        now: NOW + 60 * 60 * 1000,
        userId: 'u1',
      }),
    ).resolves.toMatchObject({ allowed: true, count: 1 });
    expect(toUtcDay(NOW + 60 * 60 * 1000)).toBe('2026-10-12');
  });

  /**
   * @example
   * No Redis configured: the budget cannot be enforced, so the work is skipped.
   */
  it('fails closed when Redis is not configured', async () => {
    service.available = false;

    await expect(
      acquireAgentSignalDailyBudget({ kind: 'feedback-classifier', now: NOW, userId: 'u1' }),
    ).resolves.toEqual({
      allowed: false,
      kind: 'feedback-classifier',
      limit: AGENT_SIGNAL_DEFAULTS.dailyFeedbackClassifierBudgetPerUser,
      reason: 'unavailable',
    });
  });

  /**
   * @example
   * A Redis error is logged and treated as an unavailable budget, never thrown.
   */
  it('fails closed without throwing when Redis errors', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    service.countClassifierCall.mockRejectedValueOnce(new Error('connection reset'));

    await expect(
      acquireAgentSignalDailyBudget({ kind: 'feedback-classifier', now: NOW, userId: 'u1' }),
    ).resolves.toMatchObject({ allowed: false, reason: 'unavailable' });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('describes denials for skip details', () => {
    expect(
      describeBudgetDenial({
        allowed: false,
        kind: 'feedback-classifier',
        limit: 200,
        reason: 'exceeded',
      }),
    ).toBe('Daily Agent Signal feedback-classifier budget exceeded (200/day).');
    expect(
      describeBudgetDenial({
        allowed: false,
        kind: 'feedback-classifier',
        limit: 200,
        reason: 'unavailable',
      }),
    ).toBe(
      'Daily Agent Signal feedback-classifier budget unavailable; skipped to stay within budget.',
    );
  });
});
