import { describe, expect, it } from 'vitest';

import { describeThrownError, isOutOfCreditsFailure, withErrorType } from '../verifierError';

describe('verifierError', () => {
  it.each([
    'Verifier failed before submitting a verdict: Budget exceeded (InsufficientBudgetForModel)',
    'LLM judge failed: Budget exceeded',
    'Verifier failed before submitting a verdict: FreePlanLimit',
  ])('reads %s as a credit refusal', (text) => {
    expect(isOutOfCreditsFailure(text)).toBe(true);
  });

  it.each([
    'Verifier failed before submitting a verdict: socket hang up',
    'Verifier completed without submitting a verdict.',
    undefined,
  ])('does not read %s as a credit refusal', (text) => {
    expect(isOutOfCreditsFailure(text)).toBe(false);
  });

  it('appends the code once', () => {
    expect(withErrorType('Budget exceeded', 'InsufficientBudgetForModel')).toBe(
      'Budget exceeded (InsufficientBudgetForModel)',
    );
    expect(withErrorType('InvalidProviderAPIKey', 'InvalidProviderAPIKey')).toBe(
      'InvalidProviderAPIKey',
    );
    expect(withErrorType(undefined, 'InsufficientBudgetForModel')).toBe(
      'InsufficientBudgetForModel',
    );
    expect(withErrorType('socket hang up')).toBe('socket hang up');
  });

  /** Regression: a thrown runtime payload was recorded as "[object Object]". */
  it('describes a thrown model-runtime payload with its code', () => {
    expect(
      describeThrownError({
        error: { message: 'Budget exceeded' },
        errorType: 'InsufficientBudgetForModel',
      }),
    ).toBe('Budget exceeded (InsufficientBudgetForModel)');
    expect(describeThrownError(new Error('boom'))).toBe('boom');
  });
});
