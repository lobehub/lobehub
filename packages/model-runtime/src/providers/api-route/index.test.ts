// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeApiRouteAI, params } from './index';

testProvider({
  Runtime: LobeApiRouteAI,
  provider: ModelProvider.ApiRoute,
  defaultBaseURL: 'https://global.api-route.com/v1',
  chatDebugEnv: 'DEBUG_API_ROUTE_CHAT_COMPLETION',
  chatModel: 'gpt-5.4-mini',
  test: { skipAPICall: true, skipErrorHandle: true },
});

describe('LobeApiRouteAI', () => {
  it('uses the API Route OpenAI-compatible endpoint', () => {
    expect(params).toMatchObject({
      baseURL: 'https://global.api-route.com/v1',
      provider: ModelProvider.ApiRoute,
    });
  });

  it('loads OpenAI model-list responses', async () => {
    const runtime = new LobeApiRouteAI({ apiKey: 'test-key' });
    vi.spyOn(runtime['client'].models, 'list').mockResolvedValue({
      data: [{ id: 'gpt-5.4-mini', object: 'model', owned_by: 'openai' }],
    } as any);

    await expect(runtime.models()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'gpt-5.4-mini' })]),
    );
  });
});
