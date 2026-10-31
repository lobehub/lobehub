// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeModelsellAI, params } from './index';

testProvider({
  Runtime: LobeModelsellAI,
  chatDebugEnv: 'DEBUG_MODELSELL_CHAT_COMPLETION',
  chatModel: 'test-model',
  defaultBaseURL: 'https://modelsell.com/v1',
  provider: ModelProvider.Modelsell,
});

describe('LobeModelsellAI', () => {
  it('uses the Modelsell provider contract', () => {
    expect(params.baseURL).toBe('https://modelsell.com/v1');
    expect(params.provider).toBe(ModelProvider.Modelsell);
  });
});
