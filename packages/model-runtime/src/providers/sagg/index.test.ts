// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeSaggAI, params } from './index';

testProvider({
  Runtime: LobeSaggAI,
  provider: ModelProvider.Sagg,
  defaultBaseURL: 'https://api.privatedeskai.com/v1',
  chatDebugEnv: 'DEBUG_SAGG_CHAT_COMPLETION',
  chatModel: 'deepseek-ai/DeepSeek-V4-Flash-0731',
  test: {
    skipAPICall: true,
    skipErrorHandle: true,
  },
});

describe('LobeSaggAI - params', () => {
  it('should have correct baseURL and provider', () => {
    expect(params.baseURL).toBe('https://api.privatedeskai.com/v1');
    expect(params.provider).toBe(ModelProvider.Sagg);
  });
});
