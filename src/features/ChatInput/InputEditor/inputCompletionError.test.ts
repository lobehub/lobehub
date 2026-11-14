import { describe, expect, it } from 'vitest';

import {
  createInputCompletionError,
  isInputCompletionAbortError,
  isInputCompletionCredentialError,
} from './inputCompletionError';

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

    it('keeps the runtime error type when tRPC only sends a transport code', () => {
      // `createRuntimeTRPCError` on the server puts the runtime error type in the
      // message and maps it onto a transport code, so a workspace without a key
      // for the personal provider arrives as a plain UNAUTHORIZED tRPC error.
      expect(
        createInputCompletionError({
          data: { code: 'UNAUTHORIZED' },
          message: 'InvalidProviderAPIKey',
        }),
      ).toEqual({
        body: undefined,
        errorType: 'InvalidProviderAPIKey',
        httpStatus: undefined,
        message: 'InvalidProviderAPIKey',
      });
    });

    it('recovers the runtime error type from a nested cause message', () => {
      expect(
        createInputCompletionError({
          cause: { message: 'NoOpenAIAPIKey' },
          data: { code: 'UNAUTHORIZED' },
          message: 'TRPC request failed',
        }).errorType,
      ).toBe('NoOpenAIAPIKey');
    });
  });

  describe('isInputCompletionCredentialError', () => {
    it('treats a missing or rejected provider key as a credential error', () => {
      expect(
        isInputCompletionCredentialError(
          createInputCompletionError(new Error('InvalidProviderAPIKey')),
        ),
      ).toBe(true);
    });

    it('does not treat budget failures as credential errors', () => {
      expect(
        isInputCompletionCredentialError(
          createInputCompletionError(new Error('InsufficientBudgetForModel')),
        ),
      ).toBe(false);
    });

    it('treats the tRPC transport shape of a missing key as a credential error', () => {
      expect(
        isInputCompletionCredentialError(
          createInputCompletionError({
            data: { code: 'UNAUTHORIZED' },
            message: 'InvalidProviderAPIKey',
          }),
        ),
      ).toBe(true);
    });

    it('does not treat a transport-only unauthorized failure as a credential error', () => {
      expect(
        isInputCompletionCredentialError(
          createInputCompletionError({
            data: { code: 'UNAUTHORIZED' },
            message: 'UNAUTHORIZED',
          }),
        ),
      ).toBe(false);
    });
  });
});
