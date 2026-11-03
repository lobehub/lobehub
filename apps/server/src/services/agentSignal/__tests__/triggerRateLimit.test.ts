import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AGENT_SIGNAL_TRIGGER_RATE_LIMIT_PER_HOUR,
  assertAgentSignalTriggerRateLimit,
  consumeAgentSignalTriggerQuota,
} from '../triggerRateLimit';

const service = vi.hoisted(() => ({
  available: true,
  counters: new Map<string, number>(),
  countManualTrigger: vi.fn(),
}));

vi.mock('@/server/services/redis', () => ({
  redisService: { agentSignal: { countManualTrigger: service.countManualTrigger } },
}));

beforeEach(() => {
  service.available = true;
  service.counters.clear();
  service.countManualTrigger.mockImplementation(async (userId: string) => {
    if (!service.available) return undefined;
    const next = (service.counters.get(userId) ?? 0) + 1;
    service.counters.set(userId, next);
    return next;
  });
});

describe('consumeAgentSignalTriggerQuota', () => {
  /**
   * ROOT CAUSE:
   *
   * `triggerSourceEvent` had no rate limit, so one user could enqueue model-backed Agent Signal
   * workflows as fast as they could call the endpoint.
   */
  it(`allows ${AGENT_SIGNAL_TRIGGER_RATE_LIMIT_PER_HOUR} triggers per hour per user`, async () => {
    const results: boolean[] = [];

    for (let index = 0; index <= AGENT_SIGNAL_TRIGGER_RATE_LIMIT_PER_HOUR; index += 1) {
      results.push(await consumeAgentSignalTriggerQuota('user-1'));
    }

    expect(results.filter(Boolean)).toHaveLength(AGENT_SIGNAL_TRIGGER_RATE_LIMIT_PER_HOUR);
    expect(results.at(-1)).toBe(false);
    // Another user keeps their own budget.
    await expect(consumeAgentSignalTriggerQuota('user-2')).resolves.toBe(true);
  });

  it('allows the call when Redis is not configured', async () => {
    service.available = false;

    await expect(consumeAgentSignalTriggerQuota('user-1')).resolves.toBe(true);
  });
});

describe('assertAgentSignalTriggerRateLimit', () => {
  it('throws TOO_MANY_REQUESTS once the budget is spent', async () => {
    for (let index = 0; index < AGENT_SIGNAL_TRIGGER_RATE_LIMIT_PER_HOUR; index += 1) {
      await assertAgentSignalTriggerRateLimit('user-1');
    }

    await expect(assertAgentSignalTriggerRateLimit('user-1')).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
    });
  });
});
