// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeEUrouterAI, params } from './index';

testProvider({
  Runtime: LobeEUrouterAI,
  provider: ModelProvider.EUrouter,
  defaultBaseURL: 'https://api.eurouter.ai/api/v1',
  chatDebugEnv: 'DEBUG_EUROUTER_CHAT_COMPLETION',
  chatModel: 'mistral-large-latest',
  test: {
    skipAPICall: true,
  },
});

describe('LobeEUrouterAI', () => {
  it('exports the expected runtime params', () => {
    expect(params.provider).toBe(ModelProvider.EUrouter);
    expect(params.baseURL).toBe('https://api.eurouter.ai/api/v1');
    expect(typeof params.models).toBe('function');
  });
});
