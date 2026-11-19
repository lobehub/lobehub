// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it, vi } from 'vitest';

import { LobeNagaAI, params } from './index';

const loadModelsMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: loadModelsMock,
}));

const chatRow = {
  architecture: { input_modalities: ['text', 'image', 'file'] },
  description: 'A chat model.',
  display_name: 'Claude Sonnet 5.5',
  id: 'anthropic/claude-sonnet-5.5',
  operations: [
    {
      endpoints: ['chat.completions', 'messages', 'responses'],
      limits: { context_window: 1_000_000 },
      operation: 'chat',
      parameters: { reasoning_effort: {}, temperature: {}, tools: {} },
    },
  ],
  pricing: [
    { meter: 'input_token', price: '0.000001' },
    { meter: 'cached_input_token', price: '0.00000005' },
    { meter: 'output_token', price: '0.000005' },
  ],
};

const imageRow = {
  id: 'black-forest-labs/flux-2-pro',
  operations: [{ endpoints: ['images.generations'], operation: 'image_generation' }],
};

const listing = (data: unknown[]) => ({
  models: { list: vi.fn().mockResolvedValue({ data }) },
});

describe('LobeNagaAI', () => {
  it('talks to the NagaAI gateway as its own provider', () => {
    expect(params.baseURL).toBe('https://api.naga.ac/v1');
    expect(params.provider).toBe(ModelProvider.NagaAI);
    expect(new LobeNagaAI({ apiKey: 'test' }).baseURL).toBe('https://api.naga.ac/v1');
  });

  it('sends chats to the Responses API', async () => {
    const instance = new LobeNagaAI({ apiKey: 'test' });
    const responses = vi
      .spyOn(instance['client'].responses, 'create')
      .mockResolvedValue(new ReadableStream() as any);
    const completions = vi
      .spyOn(instance['client'].chat.completions, 'create')
      .mockResolvedValue(new ReadableStream() as any);

    await instance.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'anthropic/claude-sonnet-5.5',
      temperature: 0,
    });

    expect(responses).toHaveBeenCalledTimes(1);
    expect(completions).not.toHaveBeenCalled();
    expect(responses.mock.calls[0][0]).toMatchObject({ model: 'anthropic/claude-sonnet-5.5' });
  });

  it('lists only the models that chat', async () => {
    const models = await params.models({ client: listing([chatRow, imageRow]) as any });

    expect(models.map((model) => model.id)).toEqual(['anthropic/claude-sonnet-5.5']);
  });

  it('reads window, abilities and per-million prices from the gateway row', async () => {
    const [model] = await params.models({ client: listing([chatRow]) as any });

    expect(model).toMatchObject({
      contextWindowTokens: 1_000_000,
      displayName: 'Claude Sonnet 5.5',
      functionCall: true,
      reasoning: true,
      vision: true,
    });
    expect(model.pricing?.units).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'textInput', rate: 1 }),
        expect.objectContaining({ name: 'textOutput', rate: 5 }),
        expect.objectContaining({ name: 'textInput_cacheRead', rate: 0.05 }),
      ]),
    );
  });

  it('does not claim abilities the row does not list', async () => {
    const plain = {
      ...chatRow,
      architecture: { input_modalities: ['text'] },
      operations: [{ ...chatRow.operations[0], parameters: { temperature: {} } }],
    };

    const [model] = await params.models({ client: listing([plain]) as any });

    expect(model).toMatchObject({ functionCall: false, reasoning: false, vision: false });
  });
});
