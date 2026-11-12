// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeEmpirioLabsAI, params } from './index';

const loadModelsMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: loadModelsMock,
}));

testProvider({
  Runtime: LobeEmpirioLabsAI,
  chatDebugEnv: 'DEBUG_EMPIRIOLABS_CHAT_COMPLETION',
  chatModel: 'gemma-4-26b-a4b',
  defaultBaseURL: 'https://api.empiriolabs.ai/v1',
  provider: ModelProvider.EmpirioLabs,
});

describe('LobeEmpirioLabsAI - custom features', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('params object', () => {
    it('should point at the EmpirioLabs AI API', () => {
      expect(params.baseURL).toBe('https://api.empiriolabs.ai/v1');
      expect(params.provider).toBe(ModelProvider.EmpirioLabs);
    });

    it('should enable chat completion debugging only when the env variable is 1', () => {
      delete process.env.DEBUG_EMPIRIOLABS_CHAT_COMPLETION;
      expect(params.debug.chatCompletion()).toBe(false);

      process.env.DEBUG_EMPIRIOLABS_CHAT_COMPLETION = '1';
      expect(params.debug.chatCompletion()).toBe(true);

      delete process.env.DEBUG_EMPIRIOLABS_CHAT_COMPLETION;
    });
  });

  describe('models', () => {
    const listModels = async (data: unknown[]) => {
      const instance = new LobeEmpirioLabsAI({ apiKey: 'test_api_key' });
      vi.spyOn(instance['client'].models, 'list').mockResolvedValue({ data } as any);

      return instance.models();
    };

    it('should list only the chat models the endpoint returns', async () => {
      const models = await listModels([
        { category: 'text', id: 'example-chat' },
        { category: 'text', id: 'example-chat:variant1' },
        { category: 'image', id: 'example-image' },
        { category: 'video', id: 'example-video' },
        { category: 'audio', id: 'example-speech' },
        { category: 'embedding', id: 'example-embedding' },
        { id: 'example-uncategorized' },
      ]);

      expect(models.map((model) => model.id)).toEqual(['example-chat']);
    });

    it('should describe a chat model with what the API says about it', async () => {
      const [model] = await listModels([
        {
          capabilities: { reasoning: true },
          category: 'text',
          context_window: 262_144,
          description: 'An example chat model.',
          display_name: 'Example Chat',
          features: ['function_calling', 'json_mode'],
          id: 'example-chat',
          input_modalities: ['text', 'image'],
          max_output_tokens: 32_768,
          pricing: { completion: '0.00000029', prompt: '0.00000005' },
        },
      ]);

      expect(model).toMatchObject({
        contextWindowTokens: 262_144,
        description: 'An example chat model.',
        displayName: 'Example Chat',
        functionCall: true,
        id: 'example-chat',
        maxOutput: 32_768,
        pricing: {
          units: [
            { name: 'textInput', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
            { name: 'textOutput', rate: 0.29, strategy: 'fixed', unit: 'millionTokens' },
          ],
        },
        reasoning: true,
        type: 'chat',
        vision: true,
      });
    });

    it('should not claim abilities the API does not list', async () => {
      const [model] = await listModels([
        { category: 'text', features: [], id: 'example-plain', input_modalities: ['text'] },
      ]);

      expect(model).toMatchObject({
        functionCall: false,
        id: 'example-plain',
        reasoning: false,
        vision: false,
      });
      expect(model.pricing).toBeUndefined();
    });

    it('should not guess an ability from a model id another provider also serves', async () => {
      const [model] = await listModels([
        {
          category: 'text',
          features: ['function_calling'],
          id: 'gemini-3-pro-image-preview',
          input_modalities: ['text', 'video'],
        },
      ]);

      expect(model).toMatchObject({
        functionCall: true,
        imageOutput: false,
        search: false,
        type: 'chat',
        video: false,
      });
    });

    it('should price a model with context tiers at its base tier', async () => {
      const [model] = await listModels([
        {
          category: 'text',
          id: 'example-tiered',
          pricing: [
            { completion: '0.00003', prompt: '0.000005' },
            { completion: '0.000045', min_context: 272_000, prompt: '0.00001' },
          ],
        },
      ]);

      expect(model.pricing).toEqual({
        units: [
          { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
          { name: 'textOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
        ],
      });
    });

    it('should keep the price of a free model at zero', async () => {
      const [model] = await listModels([
        { category: 'text', id: 'example-free', pricing: { completion: '0', prompt: '0' } },
      ]);

      expect(model.pricing).toEqual({
        units: [
          { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
          { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        ],
      });
    });

    it('should return an empty list when the endpoint returns no data', async () => {
      const instance = new LobeEmpirioLabsAI({ apiKey: 'test_api_key' });
      vi.spyOn(instance['client'].models, 'list').mockResolvedValue({} as any);

      expect(await instance.models()).toEqual([]);
    });
  });

  describe('video status', () => {
    it('should read the job with the configured key and base URL', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        json: async () => ({ job_id: 'job-1', status: 'processing' }),
        ok: true,
      });
      vi.stubGlobal('fetch', fetchMock);

      const instance = new LobeEmpirioLabsAI({
        apiKey: 'test_api_key',
        baseURL: 'https://gateway.example.com/v1',
      });

      expect(await instance.handlePollVideoStatus('job-1')).toEqual({ status: 'pending' });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://gateway.example.com/v1/jobs/job-1',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test_api_key' }),
          method: 'GET',
        }),
      );
    });
  });
});
