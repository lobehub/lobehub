import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LobeRuntimeAI } from '../BaseAI';
import { createRouterRuntime } from './createRuntime';

const audioPayload = {
  messages: [
    {
      content: [
        {
          audio_url: { mimeType: 'audio/wav', url: 'https://example.com/voice.wav' },
          type: 'audio_url' as const,
        },
      ],
      role: 'user' as const,
    },
  ],
  model: 'audio-model',
};

describe('routed chat option eligibility', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sorts only eligible options on the stream-fallback path', async () => {
    class EmptyRuntime implements LobeRuntimeAI {
      chat = vi.fn(async () => new Response(null));
    }
    const sortRouterOptions = vi.fn(({ options }) => options);
    const Runtime = createRouterRuntime({
      id: 'test-runtime',
      onRouteAttemptFinished: vi.fn(),
      routers: [
        {
          apiType: 'openai',
          models: ['audio-model'],
          options: [
            { apiKey: 'anthropic-key', apiType: 'anthropic', id: 'anthropic' },
            { apiKey: 'openai-key', apiType: 'openai', id: 'openai' },
            { apiKey: 'google-key', apiType: 'google', id: 'google' },
          ],
          runtime: EmptyRuntime as any,
        },
      ],
      shouldFallbackChatAttempt: vi.fn(async () => false),
      sortRouterOptions,
    });

    await new Runtime().chat(audioPayload).catch(() => undefined);

    expect(sortRouterOptions).toHaveBeenCalledTimes(1);
    expect(sortRouterOptions.mock.calls[0][0].options.map((option: any) => option.id)).toEqual([
      'openai',
      'google',
    ]);
  });
});
