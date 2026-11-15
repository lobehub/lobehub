// @vitest-environment node
/**
 * TTSService → initModelRuntimeFromDB → ModelRuntime → LobeDoubaoSpeechAI → fetch, with
 * only the provider row, the server env and the network mocked, so provider='doubaospeech'
 * runs through the same code a tRPC / OpenAPI request does.
 */
import { AgentRuntimeErrorType } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const providerRow = vi.hoisted(() => ({ current: undefined as any }));
const llmConfig = vi.hoisted(() => ({ current: {} as Record<string, string | undefined> }));

vi.mock('@/database/models/aiProvider', () => ({
  AiProviderModel: class {
    getAiProviderById = vi.fn(async () => providerRow.current);
  },
}));
vi.mock('@/envs/llm', () => ({ getLLMConfig: () => llmConfig.current }));
vi.mock('@/business/server/model-runtime', () => ({
  getBusinessModelRuntimeHooks: () => undefined,
}));
vi.mock('@/server/services/llmGenerationTracing/hook', () => ({
  createLLMGenerationTracingHook: () => undefined,
}));
vi.mock('@/server/globalConfig', () => ({ getServerAiProviderConfig: vi.fn() }));

const { INLINE_TTS_MAX_INPUT_CHARACTERS, TTSProviderError, TTSService } = await import('./index');

const DEFAULT_VOICE = 'zh_female_vv_uranus_bigtts';

const service = new TTSService({} as any, 'user-1');

const streamResponse = () =>
  new Response(
    [
      JSON.stringify({ code: 0, data: Buffer.from([0x49, 0x44]).toString('base64') }),
      JSON.stringify({ code: 0, data: Buffer.from([0x33]).toString('base64') }),
      JSON.stringify({ code: 20_000_000, message: 'ok', usage: { text_words: 4 } }),
    ].join('\n'),
  );

const lastHeaders = (fetchMock: ReturnType<typeof vi.fn>) =>
  (fetchMock.mock.calls.at(-1) as any)[1].headers as Record<string, string>;

describe('TTSService with provider doubaospeech', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    providerRow.current = { keyVaults: { apiKey: 'user-doubao-key' } };
    llmConfig.current = {};
    fetchMock = vi.fn(async () => streamResponse());
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('synthesizes with the API key saved in the provider settings', async () => {
    const result = await service.synthesize({
      input: '你好世界',
      model: 'seed-tts-2.0',
      params: { pitch: 2, speed: 1.2, volume: 0.8 },
      provider: 'doubaospeech',
      voice: 'zh_male_m191_uranus_bigtts',
    });

    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toBe('https://openspeech.bytedance.com/api/v3/tts/unidirectional');
    expect(init.headers['X-Api-Key']).toBe('user-doubao-key');
    expect(init.headers['X-Api-Resource-Id']).toBe('seed-tts-2.0');
    expect(JSON.parse(init.body).req_params).toEqual({
      additions: JSON.stringify({ post_process: { pitch: 2 } }),
      audio_params: { format: 'mp3', loudness_rate: -20, speech_rate: 20 },
      speaker: 'zh_male_m191_uranus_bigtts',
      text: '你好世界',
    });

    expect(new Uint8Array(result.audio)).toEqual(new Uint8Array([0x49, 0x44, 0x33]));
    expect(result.format).toBe('mp3');
    expect(result.mimeType).toBe('audio/mpeg');
    expect(result.usage?.inputCharacters).toBe(4);
    // 4 characters at 300 CNY / 1M characters, converted to USD
    expect(result.usage?.cost).toBeGreaterThan(0);
  });

  it("defaults the voice to the model card's default voice", async () => {
    await service.synthesize({ input: 'Hi', model: 'seed-tts-2.0', provider: 'doubaospeech' });

    expect(JSON.parse((fetchMock.mock.calls[0] as any)[1].body).req_params.speaker).toBe(
      DEFAULT_VOICE,
    );
  });

  it('authenticates with the legacy App ID + Access Token saved in the settings', async () => {
    providerRow.current = { keyVaults: { accessToken: 'user-token', appId: 'user-app' } };

    await service.synthesize({ input: 'Hi', model: 'seed-tts-2.0', provider: 'doubaospeech' });

    expect(lastHeaders(fetchMock)).toMatchObject({
      'X-Api-Access-Key': 'user-token',
      'X-Api-App-Id': 'user-app',
    });
    expect(lastHeaders(fetchMock)['X-Api-Key']).toBeUndefined();
  });

  it('falls back to the server credentials only when the user saved none', async () => {
    providerRow.current = undefined;
    llmConfig.current = { DOUBAOSPEECH_ACCESS_TOKEN: 'srv-token', DOUBAOSPEECH_APP_ID: 'srv-app' };
    vi.stubEnv('DOUBAOSPEECH_PROXY_URL', 'https://proxy.example.com');

    await service.synthesize({ input: 'Hi', model: 'seed-tts-2.0', provider: 'doubaospeech' });

    expect((fetchMock.mock.calls[0] as any)[0]).toBe(
      'https://proxy.example.com/api/v3/tts/unidirectional',
    );
    expect(lastHeaders(fetchMock)).toMatchObject({
      'X-Api-Access-Key': 'srv-token',
      'X-Api-App-Id': 'srv-app',
    });

    // A user App ID without its token is incomplete, not topped up with the server's.
    providerRow.current = { keyVaults: { appId: 'user-app' } };
    llmConfig.current = { DOUBAOSPEECH_API_KEY: 'srv-key' };
    await expect(
      service.synthesize({ input: 'Hi', model: 'seed-tts-2.0', provider: 'doubaospeech' }),
    ).rejects.toMatchObject({ errorType: AgentRuntimeErrorType.InvalidProviderAPIKey });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails with a readable InvalidProviderAPIKey error when no credentials are configured', async () => {
    providerRow.current = { keyVaults: {} };

    const error = await service
      .synthesize({ input: 'Hi', model: 'seed-tts-2.0', provider: 'doubaospeech' })
      .catch((e) => e);

    expect(error).toBeInstanceOf(TTSProviderError);
    expect(error.errorType).toBe(AgentRuntimeErrorType.InvalidProviderAPIKey);
    expect(error.message).toBe(
      'Doubao Speech API Key is incorrect or empty, please check your Doubao Speech API Key and try again (Doubao Speech needs an API Key, or an App ID together with its Access Token). Set it in Settings → AI Providers → Doubao Speech, or in the server environment.',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a rejected key with the InvalidProviderAPIKey copy and the upstream message', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 45_000_000, message: 'requested grant not found' }), {
        status: 403,
      }),
    );

    const error = await service
      .synthesize({ input: 'Hi', model: 'seed-tts-2.0', provider: 'doubaospeech' })
      .catch((e) => e);

    expect(error.errorType).toBe(AgentRuntimeErrorType.InvalidProviderAPIKey);
    expect(error.message).toContain('requested grant not found');
    expect(error.message).toContain('Settings → AI Providers → Doubao Speech');
  });

  it('surfaces concurrency limits as RateLimitExceeded', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: 45_000_000, message: 'quota exceeded for types: concurrency' }),
        { status: 429 },
      ),
    );

    await expect(
      service.synthesize({ input: 'Hi', model: 'seed-tts-2.0', provider: 'doubaospeech' }),
    ).rejects.toMatchObject({ errorType: AgentRuntimeErrorType.RateLimitExceeded });
  });

  it('rejects params the Doubao card does not allow before calling the API', async () => {
    for (const params of [
      { speed: 2.5 },
      { volume: 3 },
      { pitch: 20 },
      { sampleRate: 11_025 },
      { format: 'aac' as const },
      { emotion: 'happy' },
    ]) {
      await expect(
        service.synthesize({
          input: 'Hi',
          model: 'seed-tts-2.0',
          params,
          provider: 'doubaospeech',
        }),
      ).rejects.toMatchObject({ name: 'TTSRequestError', reason: 'invalid_params' });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects input over the inline cap before calling the API', async () => {
    await expect(
      service.synthesize({
        input: '字'.repeat(INLINE_TTS_MAX_INPUT_CHARACTERS + 1),
        model: 'seed-tts-2.0',
        provider: 'doubaospeech',
      }),
    ).rejects.toMatchObject({ name: 'TTSRequestError', reason: 'invalid_params' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
