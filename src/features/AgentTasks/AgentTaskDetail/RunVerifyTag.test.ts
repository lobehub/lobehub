import { describe, expect, it } from 'vitest';

import { resolveVerdict, reviewHoldOf } from './RunVerifyTag';

describe('resolveVerdict', () => {
  it('maps a run to the verdict it actually reached', () => {
    expect(resolveVerdict('passed')).toBe('passed');
    expect(resolveVerdict('failed')).toBe('failed');
    expect(resolveVerdict('errored')).toBe('errored');
  });

  it('treats an in-flight verification as running', () => {
    expect(resolveVerdict('running')).toBe('running');
    expect(resolveVerdict('verifying')).toBe('running');
  });

  it('does not claim a verdict for a run that has not been checked yet', () => {
    // A planned session has a checklist but no result; saying "verifying"
    // there would claim work that has not started.
    expect(resolveVerdict('planned')).toBe('pending');
    expect(resolveVerdict(null)).toBe('pending');
  });

  it('tells a round under repair and a delivered round apart from an unchecked one', () => {
    expect(resolveVerdict('repairing')).toBe('repairing');
    expect(resolveVerdict('delivered')).toBe('review');
  });
});

describe('reviewHoldOf', () => {
  /** Regression: the run row read "3/3 passed" on a delivery the review sent back. */
  it('reports the review outcome on a round whose checks passed', () => {
    expect(reviewHoldOf({ reviewStatus: 'rejected', status: 'passed' })).toBe('rejected');
    expect(reviewHoldOf({ reviewStatus: 'errored', status: 'passed' })).toBe('errored');
  });

  it('leaves a clean pass and any other verdict alone', () => {
    expect(reviewHoldOf({ status: 'passed' })).toBeUndefined();
    expect(reviewHoldOf({ reviewStatus: 'rejected', status: 'failed' })).toBeUndefined();
  });
});
