// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeAiOnlyAI, params } from './index';

testProvider({
  Runtime: LobeAiOnlyAI,
  provider: ModelProvider.AiOnly,
  defaultBaseURL: 'https://api.aionly.com/v1',
  chatDebugEnv: 'DEBUG_AIONLY_CHAT_COMPLETION',
  chatModel: 'gpt-4o-mini',
  test: {
    skipAPICall: true,
  },
});

describe('LobeAiOnlyAI - params', () => {
  it('should have correct baseURL and provider', () => {
    expect(params.baseURL).toBe('https://api.aionly.com/v1');
    expect(params.provider).toBe(ModelProvider.AiOnly);
  });
});
