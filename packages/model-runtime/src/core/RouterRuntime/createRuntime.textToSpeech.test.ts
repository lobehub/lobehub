import { RequestTrigger } from '@lobechat/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TextToSpeechOptions, TextToSpeechPayload, TextToSpeechResponse } from '../../types';
import type { LobeRuntimeAI } from '../BaseAI';
import { createRouterRuntime } from './createRuntime';

const payload: TextToSpeechPayload = {
  input: '你好',
  model: 'tts-1',
  params: { format: 'wav', speed: 1.1 },
  voice: 'nova',
};

describe('createRouterRuntime textToSpeech', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('returns the routed response with format and usage, and forwards onUsage', async () => {
    const usage = { cost: 0.00003, inputCharacters: 2 };
    const textToSpeech = vi.fn(
      async (_payload: TextToSpeechPayload, options?: TextToSpeechOptions) => {
        await options?.onUsage?.(usage);
        return { audio: new ArrayBuffer(4), format: 'wav', usage } as TextToSpeechResponse;
      },
    );

    class MockRuntime implements LobeRuntimeAI {
      textToSpeech = textToSpeech;
    }

    const Runtime = createRouterRuntime({
      id: 'test-runtime',
      routers: [{ apiType: 'openai', models: ['tts-1'], options: {}, runtime: MockRuntime as any }],
    });

    const onUsage = vi.fn();
    const options = { metadata: { trigger: RequestTrigger.Tts }, onUsage };
    const result = await new Runtime().textToSpeech(payload, options);

    expect(textToSpeech).toHaveBeenCalledWith(
      payload,
      expect.objectContaining({ metadata: options.metadata }),
    );
    expect(result).toMatchObject({ format: 'wav', usage });
    expect(onUsage).toHaveBeenCalledWith(usage, {
      routeAttempt: expect.objectContaining({ attemptId: expect.any(String) }),
    });
  });

  it('routes apiType elevenlabs through the ElevenLabs runtime with the channel key', async () => {
    const fetchMock = vi.fn(
      async () => new Response(new Uint8Array([0x49, 0x44, 0x33]), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const Runtime = createRouterRuntime({
      id: 'lobehub',
      routers: [
        {
          apiType: 'elevenlabs',
          models: ['eleven_flash_v2_5'],
          options: { apiKey: 'channel-xi-key' },
        },
      ],
    });

    const result = await new Runtime().textToSpeech(
      { input: 'Hi', model: 'eleven_flash_v2_5', voice: 'voice-1' },
      { metadata: { trigger: RequestTrigger.Tts } },
    );

    expect(result).toMatchObject({ format: 'mp3' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/voice-1?output_format=mp3_44100_128',
    );
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe('channel-xi-key');
    vi.unstubAllGlobals();
  });
});
