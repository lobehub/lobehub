// @vitest-environment node
import type OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';

import type { OnFinishData } from '../streams/protocol';
import { createOpenAICompatibleRuntime } from './index';
import { transformResponseToStream } from './nonStreamToStream';

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: vi.fn().mockResolvedValue([]),
}));

const chatCompletion = {
  choices: [
    {
      finish_reason: 'stop',
      index: 0,
      logprobs: null,
      message: { content: 'Hello', refusal: null, role: 'assistant' },
    },
  ],
  created: 1,
  id: 'chatcmpl-json',
  model: 'test-model',
  object: 'chat.completion',
  usage: { completion_tokens: 7, prompt_tokens: 11, total_tokens: 18 },
} as OpenAI.ChatCompletion;

/**
 * JSON response mode returns the provider body verbatim, but usage callbacks must still fire:
 * usage tracking and billing hooks only ever see usage through `onFinal`.
 */
describe('JSON response mode', () => {
  it('reports chat completion usage through onFinal and returns the raw body', async () => {
    const create = vi.fn().mockResolvedValue(chatCompletion);
    const Runtime = createOpenAICompatibleRuntime({
      customClient: {
        createClient: () => ({ chat: { completions: { create } } }) as unknown as OpenAI,
      },
      provider: 'test',
    });
    const onFinal = vi.fn<(data: OnFinishData) => void>();

    const response = await new Runtime({ apiKey: 'test' }).chat(
      {
        messages: [{ content: 'Hi', role: 'user' }],
        model: 'test-model',
        responseMode: 'json',
        stream: false,
      },
      { callback: { onFinal } },
    );

    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual(chatCompletion);
    expect(onFinal).toHaveBeenCalledTimes(1);
    expect(onFinal.mock.calls[0][0].usage).toMatchObject({
      totalInputTokens: 11,
      totalOutputTokens: 7,
    });
  });

  it('returns the provider body untouched when a transform handler rewrites it', async () => {
    const create = vi.fn().mockResolvedValue(structuredClone(chatCompletion));
    const Runtime = createOpenAICompatibleRuntime({
      chatCompletion: {
        handleTransformResponseToStream: (data) => {
          (data.choices[0].message as any).reasoning_content = 'rewritten';
          return transformResponseToStream(data);
        },
      },
      customClient: {
        createClient: () => ({ chat: { completions: { create } } }) as unknown as OpenAI,
      },
      provider: 'test',
    });

    const response = await new Runtime({ apiKey: 'test' }).chat({
      messages: [{ content: 'Hi', role: 'user' }],
      model: 'test-model',
      responseMode: 'json',
      stream: false,
    });

    expect(await response.json()).toEqual(chatCompletion);
  });
});
