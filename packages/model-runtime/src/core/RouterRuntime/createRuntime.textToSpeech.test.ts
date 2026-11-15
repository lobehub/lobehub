// @vitest-environment node
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

  it('routes apiType fishaudio through the Fish Audio runtime with the channel key', async () => {
    const fetchMock = vi.fn(
      async () => new Response(new Uint8Array([0x49, 0x44, 0x33]), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const Runtime = createRouterRuntime({
      id: 'lobehub',
      routers: [
        {
          apiType: 'fishaudio',
          models: ['s2.1-pro'],
          options: { apiKey: 'channel-fish-key' },
        },
      ],
    });

    const result = await new Runtime().textToSpeech(
      { input: 'Hi', model: 's2.1-pro', voice: 'default' },
      { metadata: { trigger: RequestTrigger.Tts } },
    );

    expect(result).toMatchObject({ format: 'mp3' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.fish.audio/v1/tts');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer channel-fish-key');
    expect(headers.model).toBe('s2.1-pro');
    vi.unstubAllGlobals();
  });

  it('routes Fish Audio through an OpenRouter openai channel: mapped id, no default voice, byte usage', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(new Uint8Array([0x49, 0x44, 0x33]), {
          headers: { 'content-type': 'audio/mpeg' },
          status: 200,
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const Runtime = createRouterRuntime({
      id: 'lobehub',
      routers: [
        {
          apiType: 'openai',
          models: ['s2.1-pro', 'drama-3', 's2-pro', 's1'],
          options: {
            apiKey: 'channel-openrouter-key',
            baseURL: 'https://openrouter.ai/api/v1',
            modelIdMapping: {
              'drama-3': 'fish-audio/drama-3',
              's1': 'fish-audio/s1',
              's2-pro': 'fish-audio/s2-pro',
              's2.1-pro': 'fish-audio/s2.1-pro',
            },
          },
        },
      ],
    });

    const onUsage = vi.fn();
    const result = await new Runtime().textToSpeech(
      { input: '你好 Hi', model: 's2.1-pro', params: { speed: 1.2 }, voice: 'default' },
      { metadata: { trigger: RequestTrigger.Tts }, onUsage },
    );

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string | URL, RequestInit];
    expect(String(url)).toBe('https://openrouter.ai/api/v1/audio/speech');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      input: '你好 Hi',
      model: 'fish-audio/s2.1-pro',
      response_format: 'mp3',
      speed: 1.2,
    });
    // 2 Han × 3 bytes + " Hi" (3) = 9 UTF-8 bytes
    expect(result).toMatchObject({ format: 'mp3', usage: { inputCharacters: 9 } });
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({ inputCharacters: 9 }),
      expect.anything(),
    );
    vi.unstubAllGlobals();
  });

  it('routes apiType doubaospeech through the Doubao Speech runtime with the channel key', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          [
            JSON.stringify({ code: 0, data: Buffer.from([1, 2]).toString('base64') }),
            JSON.stringify({ code: 20_000_000, usage: { text_words: 2 } }),
          ].join('\n'),
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const Runtime = createRouterRuntime({
      id: 'lobehub',
      routers: [
        {
          apiType: 'doubaospeech',
          models: ['seed-tts-2.0'],
          options: { apiKey: 'channel-doubao-key' },
        },
      ],
    });

    const result = await new Runtime().textToSpeech(
      { input: 'Hi', model: 'seed-tts-2.0', voice: 'zh_female_vv_uranus_bigtts' },
      { metadata: { trigger: RequestTrigger.Tts } },
    );

    expect(result).toMatchObject({ format: 'mp3' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://openspeech.bytedance.com/api/v3/tts/unidirectional');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Api-Key']).toBe('channel-doubao-key');
    expect(headers['X-Api-Resource-Id']).toBe('seed-tts-2.0');
    vi.unstubAllGlobals();
  });
});
