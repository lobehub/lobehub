// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { AgentRuntimeErrorType } from '../../types/error';
import { Lobe302AI, params } from './index';

testProvider({
  Runtime: Lobe302AI,
  provider: ModelProvider.Ai302,
  defaultBaseURL: 'https://api.302.ai/v1',
  chatDebugEnv: 'DEBUG_AI302_CHAT_COMPLETION',
  chatModel: 'gpt-3.5-turbo',
  invalidErrorType: 'InvalidProviderAPIKey',
  bizErrorType: 'ProviderBizError',
  test: {
    skipAPICall: true,
    skipErrorHandle: true,
  },
});

describe('Lobe302AI - params', () => {
  it('should have correct baseURL', () => {
    expect(params.baseURL).toBe('https://api.302.ai/v1');
    expect(params.provider).toBe(ModelProvider.Ai302);
  });

  describe('handleError', () => {
    it('should handle 401 error as InvalidProviderAPIKey', () => {
      const error = new Response('Unauthorized', { status: 401 });
      const result = params.chatCompletion?.handleError?.(error);

      expect(result?.errorType).toBe(AgentRuntimeErrorType.InvalidProviderAPIKey);
      expect(result?.error).toBe(401);
    });

    it('should handle error with status property', () => {
      const error = { status: 401, message: 'Unauthorized' };
      const result = params.chatCompletion?.handleError?.(error);

      expect(result?.errorType).toBe(AgentRuntimeErrorType.InvalidProviderAPIKey);
    });

    it('should return error for non-401 status', () => {
      const error = new Response('Bad Request', { status: 400 });
      const result = params.chatCompletion?.handleError?.(error);

      expect(result?.error).toBe(error);
      expect(result?.errorType).toBeUndefined();
    });

    it('should return error for generic errors', () => {
      const error = new Error('Network error');
      const result = params.chatCompletion?.handleError?.(error);

      expect(result?.error).toBe(error);
    });
  });
});
