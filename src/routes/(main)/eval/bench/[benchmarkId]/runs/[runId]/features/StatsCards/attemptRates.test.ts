import type { EvalRunMetrics } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { attemptRates } from './attemptRates';

const metrics = (extra: Partial<EvalRunMetrics>): EvalRunMetrics => ({
  completedCases: 50,
  errorCases: 0,
  failedCases: 9,
  passedCases: 41,
  passRate: 0.82,
  totalCases: 50,
  ...extra,
});

describe('attemptRates', () => {
  it('reports pass@k, pass^k and the per-attempt rate of a run of several attempts', () => {
    const rates = attemptRates(
      metrics({ passAllK: 0.48, passAnyAt: { '1': 0.6667, '3': 0.82 }, passAtK: 0.82 }),
      3,
    );

    expect(rates).toEqual({
      allK: { count: 24, rate: 0.48 },
      anyK: { count: 41, rate: 0.82 },
      k: 3,
      perAttempt: { rate: 0.6667 },
    });
  });

  it('falls back to the per-j estimates when the k fields are absent', () => {
    const rates = attemptRates(
      metrics({ passAllAt: { '1': 0.66, '2': 0.55, '3': 0.48 }, passAnyAt: { '3': 0.82 } }),
      3,
    );

    expect(rates?.allK).toEqual({ count: 24, rate: 0.48 });
    expect(rates?.anyK).toEqual({ count: 41, rate: 0.82 });
  });

  // An unfinished run has no pass^k yet; it must not read as 0%.
  it('leaves a rate the server has not filled undefined', () => {
    const rates = attemptRates(metrics({}), 3);

    expect(rates).toEqual({ allK: undefined, anyK: undefined, k: 3, perAttempt: undefined });
  });

  it('has nothing to add for a run of one attempt', () => {
    expect(attemptRates(metrics({ passAtK: 0.82 }), 1)).toBeUndefined();
    expect(attemptRates(undefined, 3)).toBeUndefined();
  });
});
