import { describe, expect, it } from 'vitest';

import { countAwaitingPrediction, summarizePredictRound } from './predictRound';

const pendingCheck = (overrides: Record<string, unknown> = {}) => ({
  prediction: null,
  predictionStatus: null,
  result: { userDecision: null },
  ...overrides,
});

describe('countAwaitingPrediction', () => {
  /**
   * Regression: an `accept` renders no proposal card, so the old poll (which
   * counted `prediction || userDecision`) never saw an all-accept batch finish
   * and span the full two-minute timeout on every clean delivery.
   */
  it('treats a judged accept (no card) as answered', () => {
    expect(countAwaitingPrediction([pendingCheck({ predictionStatus: 'judged' })])).toBe(0);
  });

  it('treats skips and errors as answered — they will never produce a card', () => {
    expect(
      countAwaitingPrediction([
        pendingCheck({ predictionStatus: 'skipped' }),
        pendingCheck({ predictionStatus: 'errored' }),
      ]),
    ).toBe(0);
  });

  it('keeps waiting on checks with no recorded attempt', () => {
    expect(
      countAwaitingPrediction([pendingCheck(), pendingCheck({ predictionStatus: 'judged' })]),
    ).toBe(1);
  });

  it('never waits on user-decided or unexecuted checks — the batch skips them', () => {
    expect(
      countAwaitingPrediction([
        pendingCheck({ result: { userDecision: 'accept' } }),
        { prediction: null, predictionStatus: null, result: null },
      ]),
    ).toBe(0);
  });
});

describe('summarizePredictRound', () => {
  it('reports proposals when any card surfaced', () => {
    const summary = summarizePredictRound([
      pendingCheck({ prediction: { id: 'p1' }, predictionStatus: 'judged' }),
      pendingCheck({ predictionStatus: 'judged' }),
    ]);
    expect(summary).toEqual({ judged: 2, outcome: 'proposals', proposals: 1 });
  });

  it('reports a clean bill when every verdict agreed (no cards)', () => {
    const summary = summarizePredictRound([
      pendingCheck({ predictionStatus: 'judged' }),
      pendingCheck({ predictionStatus: 'judged' }),
    ]);
    expect(summary).toEqual({ judged: 2, outcome: 'allClear', proposals: 0 });
  });

  it('reports inconclusive when nothing could be judged (all skipped/errored)', () => {
    const summary = summarizePredictRound([
      pendingCheck({ predictionStatus: 'skipped' }),
      pendingCheck({ predictionStatus: 'errored' }),
    ]);
    expect(summary).toEqual({ judged: 0, outcome: 'inconclusive', proposals: 0 });
  });

  it('ignores checks the reviewer already ruled on', () => {
    const summary = summarizePredictRound([
      pendingCheck({
        prediction: { id: 'p1' },
        predictionStatus: 'judged',
        result: { userDecision: 'reject' },
      }),
      pendingCheck({ predictionStatus: 'judged' }),
    ]);
    expect(summary).toEqual({ judged: 1, outcome: 'allClear', proposals: 0 });
  });
});
