import { describe, expect, it } from 'vitest';

import { createInputCompletionError, isInputCompletionAbortError } from './inputCompletionError';

describe('inputCompletionError', () => {
  describe('isInputCompletionAbortError', () => {
    it('treats AbortError as a cancelled autocomplete request', () => {
      expect(
        isInputCompletionAbortError({ message: 'The operation was aborted', name: 'AbortError' }),
      ).toBe(true);
    });

    it('treats nested AbortError as a cancelled autocomplete request', () => {
      expect(
        isInputCompletionAbortError({
          cause: { message: 'signal is aborted without reason', name: 'AbortError' },
          message: 'TRPC request failed',
        }),
      ).toBe(true);
    });

    it('does not treat regular failures as cancellation', () => {
      expect(isInputCompletionAbortError(new Error('InsufficientBudgetForModel'))).toBe(false);
    });
  });

  describe('createInputCompletionError', () => {
    it('extracts tRPC error metadata for the paused alert', () => {
      expect(
        createInputCompletionError({
          data: {
            errorData: { budget: { requiredCredits: 10 }, errorType: 'InsufficientBudgetForModel' },
            httpStatus: 402,
          },
          message: 'Insufficient budget for model',
        }),
      ).toEqual({
        body: { budget: { requiredCredits: 10 }, errorType: 'InsufficientBudgetForModel' },
        errorType: 'InsufficientBudgetForModel',
        httpStatus: 402,
        message: 'Insufficient budget for model',
      });
    });
  });
});
