import { describe, expect, it } from 'vitest';

import { toRuntimeErrorCause } from './runtimeErrorCause';

describe('toRuntimeErrorCause', () => {
  it('exposes a plain runtime payload as data so the client receives errorData', () => {
    const budgetError = {
      budget: { blockingRules: [{ rule: 'overflow.month' }], requiredCredits: 1000 },
      errorType: 'InsufficientBudgetForModel',
      message: 'Budget exceeded',
    };

    expect(toRuntimeErrorCause(budgetError)).toEqual({ ...budgetError, data: budgetError });
  });

  it('passes Error instances, payloads that already carry data, and primitives through', () => {
    const error = new Error('boom');
    const withData = { data: { code: 1 }, errorType: 'X' };

    expect(toRuntimeErrorCause(error)).toBe(error);
    expect(toRuntimeErrorCause(withData)).toBe(withData);
    expect(toRuntimeErrorCause('oops')).toBe('oops');
  });
});
