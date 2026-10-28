// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { AgentRuntimeErrorType } from '../../types/error';
import { isChatCompletionsModel, LobeModelflareAI, params } from './index';

testProvider({
  Runtime: LobeModelflareAI,
  provider: ModelProvider.Modelflare,
  defaultBaseURL: 'https://modelflare.dev/v1',
  chatDebugEnv: 'DEBUG_MODELFLARE_CHAT_COMPLETION',
  chatModel: 'deepseek-v4-flash',
  invalidErrorType: 'InvalidProviderAPIKey',
  bizErrorType: 'ProviderBizError',
  test: {
    skipAPICall: true,
    skipErrorHandle: true,
  },
});

describe('LobeModelflareAI - params', () => {
  it('should have correct baseURL', () => {
    expect(params.baseURL).toBe('https://modelflare.dev/v1');
    expect(params.provider).toBe(ModelProvider.Modelflare);
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

  describe('isChatCompletionsModel', () => {
    it('keeps models served on the openai endpoint', () => {
      expect(
        isChatCompletionsModel({
          id: 'gpt-5.4',
          supported_endpoint_types: ['openai', 'openai-response'],
        }),
      ).toBe(true);
    });

    it('drops image and video only models', () => {
      expect(
        isChatCompletionsModel({
          id: 'gpt-image-2',
          supported_endpoint_types: ['image-generation'],
        }),
      ).toBe(false);
      expect(
        isChatCompletionsModel({ id: 'kling-3.0', supported_endpoint_types: ['openai-video'] }),
      ).toBe(false);
    });

    it('drops models without endpoint metadata', () => {
      expect(isChatCompletionsModel({ id: 'unknown-model' })).toBe(false);
      expect(isChatCompletionsModel({ id: 'empty-model', supported_endpoint_types: [] })).toBe(
        false,
      );
    });
  });
});
