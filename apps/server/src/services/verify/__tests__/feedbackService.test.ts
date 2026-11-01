import { describe, expect, it } from 'vitest';

import { computeFalseFlags } from '../feedbackService';

describe('computeFalseFlags', () => {
  it('marks a false positive when verifier failed but user rejected/overrode', () => {
    expect(computeFalseFlags('failed', 'rejected')).toEqual({
      isFalseNegative: false,
      isFalsePositive: true,
    });
    expect(computeFalseFlags('failed', 'overridden')).toEqual({
      isFalseNegative: false,
      isFalsePositive: true,
    });
  });

  it('marks a false negative when verifier passed but user rejected', () => {
    expect(computeFalseFlags('passed', 'rejected')).toEqual({
      isFalseNegative: true,
      isFalsePositive: false,
    });
  });

  it('marks neither when the user accepts the verdict', () => {
    expect(computeFalseFlags('failed', 'accepted')).toEqual({
      isFalseNegative: false,
      isFalsePositive: false,
    });
    expect(computeFalseFlags('passed', 'accepted')).toEqual({
      isFalseNegative: false,
      isFalsePositive: false,
    });
  });

  it('treats uncertain verdicts as neither FP nor FN', () => {
    expect(computeFalseFlags('uncertain', 'rejected')).toEqual({
      isFalseNegative: false,
      isFalsePositive: false,
    });
  });
});
