// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeTokenMarketAI, params } from './index';

testProvider({
  Runtime: LobeTokenMarketAI,
  chatDebugEnv: 'DEBUG_TOKENMARKET_CHAT_COMPLETION',
  chatModel: 'gpt-5.4-mini',
  defaultBaseURL: 'https://api.tokensmarket.ai/v1',
  provider: ModelProvider.TokenMarket,
  test: {
    skipAPICall: true,
  },
});

describe('LobeTokenMarketAI - params', () => {
  it('should use the Token Market endpoint and provider id', () => {
    expect(params.baseURL).toBe('https://api.tokensmarket.ai/v1');
    expect(params.models).toBeTypeOf('function');
    expect(params.provider).toBe(ModelProvider.TokenMarket);
  });

  it('should enable debug logging only when requested', () => {
    delete process.env.DEBUG_TOKENMARKET_CHAT_COMPLETION;
    expect(params.debug?.chatCompletion()).toBe(false);

    process.env.DEBUG_TOKENMARKET_CHAT_COMPLETION = '1';
    expect(params.debug?.chatCompletion()).toBe(true);
    delete process.env.DEBUG_TOKENMARKET_CHAT_COMPLETION;
  });
});
