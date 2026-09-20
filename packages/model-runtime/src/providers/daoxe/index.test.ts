// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeDaoXEAI, params } from './index';

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: vi.fn().mockResolvedValue([]),
}));

testProvider({
  Runtime: LobeDaoXEAI,
  chatDebugEnv: 'DEBUG_DAOXE_CHAT_COMPLETION',
  chatModel: 'gemini-2.5-flash',
  defaultBaseURL: 'https://daoxe.com/v1',
  provider: ModelProvider.DaoXE,
  test: {
    skipAPICall: true,
  },
});

describe('LobeDaoXEAI models', () => {
  it('fetches and normalizes the models available to the API key', async () => {
    const list = vi.fn().mockResolvedValue({
      data: [{ id: 'gemini-2.5-flash' }, { id: 'claude-sonnet-4-6' }],
    });

    const models = await params.models!({
      client: { models: { list } } as any,
    });

    expect(list).toHaveBeenCalledOnce();
    expect(models.map((model) => model.id)).toEqual(['gemini-2.5-flash', 'claude-sonnet-4-6']);
  });

  it('handles an empty model response', async () => {
    const models = await params.models!({
      client: { models: { list: vi.fn().mockResolvedValue({}) } } as any,
    });

    expect(models).toEqual([]);
  });
});
