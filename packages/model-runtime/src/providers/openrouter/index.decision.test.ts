// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LobeOpenRouterAI } from './index';

const loadModelsMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: loadModelsMock,
}));

vi.spyOn(console, 'error').mockImplementation(() => {});

const chatModel = {
  architecture: { input_modalities: ['text'], output_modalities: ['text'] },
  context_length: 8192,
  created: 1679587200,
  id: 'openai/gpt-4',
  name: 'OpenAI: GPT-4',
  pricing: { completion: '0.00006', prompt: '0.00003' },
  supported_parameters: ['tools'],
  top_provider: { context_length: 8192, is_moderated: false, max_completion_tokens: 4096 },
};

const decisionModel = {
  architecture: { input_modalities: ['text'], output_modalities: ['decisions'] },
  context_length: 64000,
  created: 1789603200,
  description: 'Calibrated probabilities for typed questions.',
  id: 'typesafe/jev-1.13',
  name: 'TypeSafe: Jev 1.13',
  pricing: { completion: '0', prompt: '0.000000042' },
};

const stubModelsApi = (decisionResponse: () => Promise<unknown>) =>
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      url.includes('output_modalities=decisions')
        ? decisionResponse()
        : Promise.resolve({
            json: async () => ({ data: url.endsWith('/images/models') ? [] : [chatModel] }),
            ok: true,
          }),
    ),
  );

describe('LobeOpenRouterAI decision models', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('lists decision models as decision cards priced on input only', async () => {
    stubModelsApi(async () => ({ json: async () => ({ data: [decisionModel] }), ok: true }));

    const models = await new LobeOpenRouterAI({ apiKey: 'test' }).models();

    expect(models.find((model) => model.id === 'openai/gpt-4')?.type).toBe('chat');
    expect(models.find((model) => model.id === 'typesafe/jev-1.13')).toMatchObject({
      contextWindowTokens: 64000,
      displayName: 'TypeSafe: Jev 1.13',
      pricing: { units: [expect.objectContaining({ name: 'textInput', rate: 0.042 })] },
      type: 'decision',
    });
  });

  it('keeps the chat model list when the decision list fails', async () => {
    stubModelsApi(async () => ({ ok: false, status: 500 }));

    const models = await new LobeOpenRouterAI({ apiKey: 'test' }).models();

    expect(models.map((model) => model.id)).toEqual(['openai/gpt-4']);
  });

  it('discovers chat, decision and image cards through an authenticated custom endpoint', async () => {
    const fetchCatalog = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      if (
        request.headers.get('authorization') !== 'Bearer gateway-key' ||
        request.headers.get('x-gateway') !== 'required'
      ) {
        return Response.json({}, { status: 401 });
      }

      const url = new URL(request.url);
      expect(url.origin).toBe('https://gateway.example');
      return Response.json({
        data: url.searchParams.has('output_modalities')
          ? [decisionModel]
          : url.pathname.endsWith('/images/models')
            ? [
                {
                  architecture: { input_modalities: ['text'], output_modalities: ['image'] },
                  created: 1700000000,
                  id: 'provider/image-model',
                  name: 'Image Model',
                  supported_parameters: {},
                },
              ]
            : [chatModel],
      });
    });
    const models = await new LobeOpenRouterAI({
      apiKey: 'gateway-key',
      baseURL: 'https://gateway.example/api/v1/',
      defaultHeaders: { 'X-Gateway': 'required' },
      fetch: fetchCatalog,
    }).models();

    expect(models.map(({ id, type }) => ({ id, type }))).toEqual([
      { id: chatModel.id, type: 'chat' },
      { id: decisionModel.id, type: 'decision' },
      { id: 'provider/image-model', type: 'image' },
    ]);
  });
});
