import { describe, expect, it } from 'vitest';

import { AgentRuntimeErrorType } from '../types/error';
import { AgentRuntimeError } from './createError';

describe('AgentRuntimeError', () => {
  describe('chat', () => {
    it('should return the same ChatCompletionErrorPayload', () => {
      const errorPayload = {
        error: { message: 'Chat completion failed' },
        errorType: AgentRuntimeErrorType.InvalidProviderAPIKey,
        provider: 'openai',
      };

      const result = AgentRuntimeError.chat(errorPayload);
      expect(result).toBe(errorPayload);
      expect(result).toEqual(errorPayload);
    });
  });

  describe('createError', () => {
    it('should create AgentInitErrorPayload with error type and error', () => {
      const error = new Error('Test error');
      const result = AgentRuntimeError.createError(AgentRuntimeErrorType.AgentRuntimeError, error);

      expect(result).toEqual({
        error,
        errorType: AgentRuntimeErrorType.AgentRuntimeError,
      });
    });

    it('should create AgentInitErrorPayload with string error type', () => {
      const error = { message: 'Custom error' };
      const result = AgentRuntimeError.createError('CustomErrorType', error);

      expect(result).toEqual({
        error,
        errorType: 'CustomErrorType',
      });
    });

    it('should create AgentInitErrorPayload with numeric error type', () => {
      const error = 'Error message';
      const result = AgentRuntimeError.createError(500, error);

      expect(result).toEqual({
        error,
        errorType: 500,
      });
    });

    it('should create AgentInitErrorPayload without error parameter', () => {
      const result = AgentRuntimeError.createError(AgentRuntimeErrorType.ModelNotFound);

      expect(result).toEqual({
        error: undefined,
        errorType: AgentRuntimeErrorType.ModelNotFound,
      });
    });
  });

  describe('createImage', () => {
    it('should return the same CreateImageErrorPayload', () => {
      const errorPayload = {
        error: { message: 'Image creation failed' },
        errorType: AgentRuntimeErrorType.ModelNotFound,
        provider: 'dalle',
      };

      const result = AgentRuntimeError.createImage(errorPayload);
      expect(result).toBe(errorPayload);
      expect(result).toEqual(errorPayload);
    });
  });
});
