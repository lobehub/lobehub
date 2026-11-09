// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it, vi } from 'vitest';

import { createOpenAICompatibleRuntime } from './index';

const MAX_LENGTH = 64;
// Synthetic identifiers from https://github.com/lobehub/lobehub/issues/20977: the
// naive `lobe:${user}:${model}` key for these parts is 71 characters.
const longUser = `user_${'a'.repeat(27)}`;
const responsesModel = 'gpt-4o@preset/example-cache-tests';
const chatModel = 'gpt-4o-cache-layer-experimental-build';

const createProvider = () =>
  createOpenAICompatibleRuntime({
    baseURL: 'https://api.openai.com/v1',
    provider: ModelProvider.OpenAI,
  });

describe('automatic prompt_cache_key length bound', () => {
  it('bounds the key sent on the Responses path', async () => {
    const Provider = createProvider();
    const instance = new Provider({ apiKey: 'test' });
    const create = vi
      .spyOn(instance['client'].responses, 'create')
      .mockResolvedValue({ output_text: '{"ok":true}' } as any);

    await instance.generateObject(
      {
        messages: [{ content: 'Hi', role: 'user' }],
        model: responsesModel,
        responseApi: true,
        schema: {
          name: 'result',
          schema: { properties: { ok: { type: 'boolean' } }, type: 'object' as const },
        },
      },
      { user: longUser },
    );

    const request = create.mock.calls[0][0] as { prompt_cache_key: string };

    expect(request.prompt_cache_key).toBeDefined();
    expect(request.prompt_cache_key.length).toBeLessThanOrEqual(MAX_LENGTH);
  });

  it('bounds the key sent on the Chat Completions path', async () => {
    const Provider = createProvider();
    const instance = new Provider({ apiKey: 'test' });
    const create = vi
      .spyOn(instance['client'].chat.completions, 'create')
      .mockResolvedValue(new ReadableStream() as any);

    await instance.chat(
      { messages: [{ content: 'Hi', role: 'user' }], model: chatModel, temperature: 0 },
      { user: longUser },
    );

    const request = create.mock.calls[0][0] as { prompt_cache_key: string };

    expect(request.prompt_cache_key).toBeDefined();
    expect(request.prompt_cache_key.length).toBeLessThanOrEqual(MAX_LENGTH);
  });
});
