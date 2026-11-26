// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeSteadyRouterAI, params } from './index';

testProvider({
  Runtime: LobeSteadyRouterAI,
  provider: ModelProvider.SteadyRouter,
  defaultBaseURL: 'https://api.steadyrouter.com/v1',
  chatDebugEnv: 'DEBUG_STEADYROUTER_CHAT_COMPLETION',
  chatModel: 'deepseek-v4-flash',
  invalidErrorType: 'InvalidProviderAPIKey',
  bizErrorType: 'ProviderBizError',
  test: {
    skipAPICall: true,
    skipErrorHandle: true,
  },
});

describe('LobeSteadyRouterAI - params', () => {
  it('should point at the gateway', () => {
    expect(params.baseURL).toBe('https://api.steadyrouter.com/v1');
    expect(params.provider).toBe(ModelProvider.SteadyRouter);
  });
});
