import { describe, expect, it } from 'vitest';

import {
  freshObservation,
  subscriptionPolicySchema,
  subscriptionWakes,
} from '../subscriptionPolicy';

const policy = { maxAgeMs: 1000, maxFutureSkewMs: 10 };
const now = 100_000;

describe('Widget subscription eligibility and planning cadence', () => {
  it('rejects stale, future and invalid time observations at evaluation time', () => {
    expect(freshObservation(new Date(now - 1000), policy, now)).toBe(true);
    expect(freshObservation(new Date(now - 1001), policy, now)).toBe(false);
    expect(freshObservation(new Date(now + 11), policy, now)).toBe(false);
    expect(freshObservation('invalid', policy, now)).toBe(false);
    expect(freshObservation(new Date(now), policy, now + 1001)).toBe(false);
  });

  it('does not plan per sample inside the observation window and wakes without arrivals at its boundary', () => {
    const condition = { type: 'observation_window' as const, intervalMs: 1000 };
    const lastWake = new Date(now).toISOString();
    for (let n = 1; n < 1000; n += 10)
      expect(subscriptionWakes(condition, 100, 0, lastWake, now + n)).toBe(false);
    expect(subscriptionWakes(condition, undefined, undefined, lastWake, now + 1000)).toBe(true);
  });

  it('rounds thresholds to the authoritative numeric scale', () => {
    expect(
      subscriptionWakes(
        { type: 'threshold', target: 0.1234567, op: 'eq' },
        0.123457,
        undefined,
        undefined,
        now,
      ),
    ).toBe(true);
    expect(
      subscriptionWakes({ type: 'change', minimumAbsoluteChange: 2 }, 1, undefined, undefined, now),
    ).toBe(false);
  });

  it('rejects invalid durable policies', () => {
    for (const maxAgeMs of [0, -1, Infinity, NaN])
      expect(
        subscriptionPolicySchema.safeParse({
          freshnessPolicy: { ...policy, maxAgeMs },
          wakeCondition: { type: 'each_valid_run' },
        }).success,
      ).toBe(false);
    expect(
      subscriptionPolicySchema.safeParse({
        freshnessPolicy: policy,
        wakeCondition: { type: 'observation_window', intervalMs: 0 },
      }).success,
    ).toBe(false);
  });
});
