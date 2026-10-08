// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeCheaperInferenceAI, params } from './index';

const loadModelsMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: loadModelsMock,
}));

testProvider({
  Runtime: LobeCheaperInferenceAI,
  provider: ModelProvider.CheaperInference,
  defaultBaseURL: 'https://api.cheaperinference.com/v1',
  chatDebugEnv: 'DEBUG_CHEAPERINFERENCE_CHAT_COMPLETION',
  responseDebugEnv: 'DEBUG_CHEAPERINFERENCE_RESPONSES',
  chatModel: 'gpt-5.4-mini',
  test: {
    skipAPICall: true,
    useResponsesAPI: true,
  },
});

describe('LobeCheaperInferenceAI - API mode', () => {
  it('should send Claude models through Chat Completions', async () => {
    const instance = new LobeCheaperInferenceAI({ apiKey: 'test' });
    const chatCreate = vi
      .spyOn(instance['client'].chat.completions, 'create')
      .mockResolvedValue(new ReadableStream() as any);
    const responsesCreate = vi
      .spyOn(instance['client'].responses, 'create')
      .mockResolvedValue(new ReadableStream() as any);

    await instance.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'claude-sonnet-5',
    });

    expect(chatCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-sonnet-5' }),
      expect.anything(),
    );
    expect(responsesCreate).not.toHaveBeenCalled();
  });
});

describe('LobeCheaperInferenceAI - params', () => {
  it('should have correct baseURL and provider', () => {
    expect(params.baseURL).toBe('https://api.cheaperinference.com/v1');
    expect(params.provider).toBe(ModelProvider.CheaperInference);
  });

  describe('models', () => {
    it('should keep text models and map context and output limits', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                context_length: 400_000,
                id: 'gpt-5.4-mini',
                max_output_tokens: 128_000,
                type: 'text',
              },
              { id: 'some-image-model', type: 'image' },
              { id: 'some-video-model', type: 'video' },
            ],
          }),
        },
      };

      const models = await params.models({ client: mockClient as any });

      expect(mockClient.models.list).toHaveBeenCalledTimes(1);
      expect(models).toHaveLength(1);
      expect(models[0]).toMatchObject({
        contextWindowTokens: 400_000,
        id: 'gpt-5.4-mini',
        maxOutput: 128_000,
        type: 'chat',
      });
    });

    it('should return an empty list when the API returns no data', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({}),
        },
      };

      const models = await params.models({ client: mockClient as any });

      expect(models).toEqual([]);
    });
  });
});
