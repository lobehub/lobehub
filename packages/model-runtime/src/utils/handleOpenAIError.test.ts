import OpenAI from 'openai';
import { describe, expect, it } from 'vitest';

import { AgentRuntimeErrorType } from '../types/error';
import { handleOpenAIError } from './handleOpenAIError';

describe('handleOpenAIError', () => {
  describe('OpenAI APIError handling', () => {
    it('should handle OpenAI APIError with error object', () => {
      const apiError = new OpenAI.APIError(
        472,
        { error: { message: 'API error', type: 'invalid_request' } },
        'test-message',
        { status: 400 } as any,
      );

      const result = handleOpenAIError(apiError);

      expect(result.errorResult).toEqual({
        error: { message: 'API error', type: 'invalid_request' },
      });
      expect(result.message).toBe(apiError.message);
      expect(result.RuntimeError).toBeUndefined();
    });

    it('should handle OpenAI APIError with cause', () => {
      const cause = { message: 'Network error', code: 'ECONNRESET' };
      const apiError = new OpenAI.APIError(472, null as any, 'test-message', {
        status: 500,
      } as any);
      (apiError as any).cause = cause;

      const result = handleOpenAIError(apiError);

      expect(result.errorResult).toEqual(cause);
      expect(result.message).toBe(apiError.message);
      expect(result.RuntimeError).toBeUndefined();
    });

    it('should handle OpenAI APIError without error or cause', () => {
      const headers = { 'content-type': 'application/json' };
      const apiError = new OpenAI.APIError(472, null as any, 'test-message', {
        status: 401,
        headers,
      } as any);

      const result = handleOpenAIError(apiError);

      expect(result.errorResult).toEqual({
        headers: { headers, status: 401 },
        status: 472,
      });
      expect(result.message).toBe(apiError.message);
      expect(result.RuntimeError).toBeUndefined();
    });

    it('should handle OpenAI APIError with both error and cause', () => {
      const errorObject = { message: 'API error', type: 'rate_limit' };
      const cause = { message: 'Rate limit exceeded' };
      const apiError = new OpenAI.APIError(472, { error: errorObject }, 'test-message', {
        status: 429,
      } as any);
      (apiError as any).cause = cause;

      const result = handleOpenAIError(apiError);

      // Should prioritize error over cause
      expect(result.errorResult).toEqual({ error: errorObject });
      expect(result.message).toBe(apiError.message);
    });
  });

  describe('Non-OpenAI error handling', () => {
    it('should handle generic Error', () => {
      const error = new Error('Generic error');
      error.cause = { details: 'Error details' };

      const result = handleOpenAIError(error);

      expect(result).toEqual({
        RuntimeError: AgentRuntimeErrorType.AgentRuntimeError,
        errorResult: {
          cause: { details: 'Error details' },
          message: 'Generic error',
          name: 'Error',
        },
        message: 'Generic error',
      });
    });

    it('should handle Error without cause', () => {
      const error = new Error('Simple error');

      const result = handleOpenAIError(error);

      expect(result).toEqual({
        RuntimeError: AgentRuntimeErrorType.AgentRuntimeError,
        errorResult: {
          cause: undefined,
          message: 'Simple error',
          name: 'Error',
        },
        message: 'Simple error',
      });
    });

    it('should handle custom Error types', () => {
      class CustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = 'CustomError';
        }
      }

      const error = new CustomError('Custom error message');
      const result = handleOpenAIError(error);

      expect(result).toEqual({
        RuntimeError: AgentRuntimeErrorType.AgentRuntimeError,
        errorResult: {
          cause: undefined,
          message: 'Custom error message',
          name: 'CustomError',
        },
        message: 'Custom error message',
      });
    });

    it('should handle non-Error objects', () => {
      const errorObject = {
        message: 'Object error',
        code: 'CUSTOM_ERROR',
      };

      const result = handleOpenAIError(errorObject);

      expect(result).toEqual({
        RuntimeError: AgentRuntimeErrorType.AgentRuntimeError,
        errorResult: {
          cause: undefined,
          message: 'Object error',
          name: undefined,
        },
        message: 'Object error',
      });
    });
  });
});
