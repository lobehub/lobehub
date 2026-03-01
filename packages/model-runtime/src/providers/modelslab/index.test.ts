// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeModelsLabAI, params } from './index';

const provider = ModelProvider.ModelsLab;
const defaultBaseURL = 'https://modelslab.com/api/uncensored-chat/v1';

testProvider({
  Runtime: LobeModelsLabAI,
  bizErrorType: 'ProviderBizError',
  chatDebugEnv: 'DEBUG_MODELSLAB_CHAT_COMPLETION',
  chatModel: 'meta-llama/Meta-Llama-3-8B-Instruct',
  defaultBaseURL,
  invalidErrorType: 'InvalidProviderAPIKey',
  provider,
  test: {
    skipAPICall: true,
    skipErrorHandle: true,
  },
});

describe('LobeModelsLabAI', () => {
  describe('params export', () => {
    it('should export params object', () => {
      expect(params).toBeDefined();
      expect(params.provider).toBe(ModelProvider.ModelsLab);
      expect(params.baseURL).toBe('https://modelslab.com/api/uncensored-chat/v1');
    });

    it('should have debug configuration', () => {
      expect(params.debug).toBeDefined();
      expect(params.debug.chatCompletion).toBeDefined();
      expect(typeof params.debug.chatCompletion).toBe('function');
    });
  });
});
