// @vitest-environment node
import type OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';

import { createOpenAICompatibleRuntime } from '../openaiCompatibleFactory';
import { createRouterRuntime } from './createRuntime';

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: vi.fn().mockResolvedValue([]),
}));

const completion = {
  choices: [
    {
      finish_reason: 'stop',
      index: 0,
      logprobs: null,
      message: { content: 'answer', refusal: null, role: 'assistant' },
    },
  ],
  created: 1,
  id: 'chatcmpl-json',
  model: 'gpt-4',
  object: 'chat.completion',
  usage: { completion_tokens: 7, prompt_tokens: 11, total_tokens: 18 },
} as OpenAI.ChatCompletion;

const ProviderRuntime = createOpenAICompatibleRuntime({
  customClient: {
    createClient: () =>
      ({
        chat: { completions: { create: vi.fn().mockResolvedValue(completion) } },
      }) as unknown as OpenAI,
  },
  provider: 'test-provider',
});

describe('RouterRuntime JSON response mode', () => {
  it.each([
    ['stream fallback', true],
    ['direct fallback', false],
  ])(
    'records provider usage on the attempt and the final callback (%s)',
    async (_label, fallbackChatAttempt) => {
      const finished = vi.fn();
      const onFinal = vi.fn();
      const Runtime = createRouterRuntime({
        id: 'test-runtime',
        onRouteAttemptFinished: finished,
        routers: [
          {
            apiType: 'openai',
            models: ['gpt-4'],
            options: { apiKey: 'test' },
            runtime: ProviderRuntime,
          },
        ],
        ...(fallbackChatAttempt && { shouldFallbackChatAttempt: () => true }),
      });

      const response = await new Runtime().chat(
        { messages: [], model: 'gpt-4', responseMode: 'json', stream: false },
        { callback: { onFinal } },
      );

      await expect(response.json()).resolves.toEqual(completion);
      expect(finished).toHaveBeenCalledOnce();
      expect(finished.mock.calls[0][0]).toMatchObject({
        outcome: 'completed',
        streaming: false,
        usage: { totalInputTokens: 11, totalOutputTokens: 7 },
      });
      expect(onFinal).toHaveBeenCalledOnce();
      expect(onFinal.mock.calls[0][0].usage).toMatchObject({
        totalInputTokens: 11,
        totalOutputTokens: 7,
      });
    },
  );
});
