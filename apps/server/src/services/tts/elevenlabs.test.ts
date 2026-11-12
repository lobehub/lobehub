// @vitest-environment node
/**
 * TTSService → initModelRuntimeFromDB → ModelRuntime → LobeElevenLabsAI → fetch, with only
 * the provider row, the server env and the network mocked, so provider='elevenlabs' runs
 * through the same code a tRPC / OpenAPI request does.
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

const { INLINE_TTS_MAX_INPUT_CHARACTERS, TTSProviderError, TTSRequestError, TTSService } =
  await import('./index');

const DEFAULT_VOICE = 'CwhRBWXzGAHq8TQ4Fs17';
const AUDIO = new Uint8Array([0x49, 0x44, 0x33, 0x04]);

const service = new TTSService({} as any, 'user-1');

describe('TTSService with provider elevenlabs', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    providerRow.current = { keyVaults: { apiKey: 'user-xi-key' } };
    llmConfig.current = {};
    fetchMock = vi.fn(
      async () =>
        new Response(AUDIO, {
          headers: { 'content-type': 'audio/mpeg', 'character-cost': '4' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('synthesizes with the key saved in the provider settings', async () => {
    const result = await service.synthesize({
      input: 'Hello world',
      model: 'eleven_multilingual_v2',
      params: { format: 'opus', speed: 1.1 },
      provider: 'elevenlabs',
      voice: 'gOupLcAkjEnguROwi4oS',
    });

    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/gOupLcAkjEnguROwi4oS?output_format=opus_48000_128',
    );
    expect(init.headers['xi-api-key']).toBe('user-xi-key');
    expect(JSON.parse(init.body)).toEqual({
      model_id: 'eleven_multilingual_v2',
      text: 'Hello world',
      voice_settings: { speed: 1.1 },
    });

    expect(new Uint8Array(result.audio)).toEqual(AUDIO);
    expect(result.format).toBe('opus');
    expect(result.mimeType).toBe('audio/opus');
    // 11 billed characters at the card's $80 / 1M characters
    expect(result.usage).toEqual({ cost: 0.000_88, inputCharacters: 11 });
  });

  it("defaults the voice to the model card's default voice", async () => {
    await service.synthesize({ input: 'Hi', model: 'eleven_v4', provider: 'elevenlabs' });

    expect(fetchMock.mock.calls[0][0]).toContain(`/v1/text-to-speech/${DEFAULT_VOICE}?`);
    expect(JSON.parse((fetchMock.mock.calls[0] as any)[1].body).model_id).toBe('eleven_v4');
  });

  it('falls back to ELEVENLABS_API_KEY when the user saved no key', async () => {
    providerRow.current = undefined;
    llmConfig.current = { ELEVENLABS_API_KEY: 'server-xi-key' };

    await service.synthesize({ input: 'Hi', model: 'eleven_flash_v2_5', provider: 'elevenlabs' });

    expect((fetchMock.mock.calls[0] as any)[1].headers['xi-api-key']).toBe('server-xi-key');
  });

  it('uses the user base URL, and ELEVENLABS_PROXY_URL with the server key', async () => {
    providerRow.current = {
      keyVaults: { apiKey: 'user-xi-key', baseURL: 'https://api.eu.residency.elevenlabs.io' },
    };
    await service.synthesize({ input: 'Hi', model: 'eleven_v4', provider: 'elevenlabs' });
    expect(fetchMock.mock.calls[0][0]).toMatch(
      /^https:\/\/api\.eu\.residency\.elevenlabs\.io\/v1\/text-to-speech\//,
    );

    providerRow.current = undefined;
    llmConfig.current = { ELEVENLABS_API_KEY: 'server-xi-key' };
    vi.stubEnv('ELEVENLABS_PROXY_URL', 'https://proxy.example.com/v1');
    await service.synthesize({ input: 'Hi', model: 'eleven_v4', provider: 'elevenlabs' });
    expect(fetchMock.mock.calls[1][0]).toMatch(
      /^https:\/\/proxy\.example\.com\/v1\/text-to-speech\//,
    );
  });

  it('fails with a readable InvalidProviderAPIKey error when no key is configured', async () => {
    providerRow.current = { keyVaults: {} };

    const error = await service
      .synthesize({ input: 'Hi', model: 'eleven_v4', provider: 'elevenlabs' })
      .catch((e) => e);

    expect(error).toBeInstanceOf(TTSProviderError);
    expect(error.errorType).toBe(AgentRuntimeErrorType.InvalidProviderAPIKey);
    expect(error.message).toBe(
      'ElevenLabs API Key is incorrect or empty, please check your ElevenLabs API Key and try again. Set it in Settings → AI Providers → ElevenLabs, or in the server environment.',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces an upstream 401 with the InvalidProviderAPIKey copy and the ElevenLabs message', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ detail: { message: 'Invalid API key', status: 'invalid_api_key' } }),
        { status: 401 },
      ),
    );

    const error = await service
      .synthesize({ input: 'Hi', model: 'eleven_v4', provider: 'elevenlabs' })
      .catch((e) => e);

    expect(error).toBeInstanceOf(TTSProviderError);
    expect(error.errorType).toBe(AgentRuntimeErrorType.InvalidProviderAPIKey);
    expect(error.message).toBe(
      'ElevenLabs API Key is incorrect or empty, please check your ElevenLabs API Key and try again (ElevenLabs API error (401): Invalid API key). Set it in Settings → AI Providers → ElevenLabs, or in the server environment.',
    );
  });

  it('surfaces an upstream 429 as RateLimitExceeded', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: { message: 'busy', status: 'system_busy' } }), {
        status: 429,
      }),
    );

    await expect(
      service.synthesize({ input: 'Hi', model: 'eleven_v4', provider: 'elevenlabs' }),
    ).rejects.toMatchObject({
      errorType: AgentRuntimeErrorType.RateLimitExceeded,
      message: 'ElevenLabs API error (429): busy',
    });
  });

  it('rejects params the ElevenLabs card does not allow before calling the API', async () => {
    await expect(
      service.synthesize({
        input: 'Hi',
        model: 'eleven_multilingual_v2',
        params: { speed: 1.5 },
        provider: 'elevenlabs',
      }),
    ).rejects.toBeInstanceOf(TTSRequestError);

    await expect(
      service.synthesize({
        input: 'Hi',
        model: 'eleven_multilingual_v2',
        params: { format: 'aac' },
        provider: 'elevenlabs',
      }),
    ).rejects.toMatchObject({ reason: 'invalid_params' });

    // v3 / v4 declare no speed
    await expect(
      service.synthesize({
        input: 'Hi',
        model: 'eleven_v4',
        params: { speed: 1 },
        provider: 'elevenlabs',
      }),
    ).rejects.toMatchObject({ message: 'params.speed not supported by this model' });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caps ElevenLabs models routed through the LobeHub provider too', async () => {
    await expect(
      service.synthesize({
        input: 'a'.repeat(INLINE_TTS_MAX_INPUT_CHARACTERS + 1),
        model: 'eleven_flash_v2_5',
        provider: 'lobehub',
      }),
    ).rejects.toMatchObject({ name: 'TTSRequestError', reason: 'invalid_params' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('counts the inline cap in Unicode characters, so emoji at the limit pass', async () => {
    // Each emoji is two UTF-16 units but one billed character.
    await service.synthesize({
      input: '🎙'.repeat(INLINE_TTS_MAX_INPUT_CHARACTERS),
      model: 'eleven_flash_v2_5',
      provider: 'elevenlabs',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(
      service.synthesize({
        input: '🎙'.repeat(INLINE_TTS_MAX_INPUT_CHARACTERS + 1),
        model: 'eleven_flash_v2_5',
        provider: 'elevenlabs',
      }),
    ).rejects.toMatchObject({ reason: 'invalid_params' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects input over the inline cap before calling the API', async () => {
    await expect(
      service.synthesize({
        input: 'a'.repeat(INLINE_TTS_MAX_INPUT_CHARACTERS + 1),
        model: 'eleven_flash_v2_5',
        provider: 'elevenlabs',
      }),
    ).rejects.toMatchObject({ name: 'TTSRequestError', reason: 'invalid_params' });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('drops the legacy top-level speed for v4, which declares none', async () => {
    await service.synthesize({ input: 'Hi', model: 'eleven_v4', provider: 'elevenlabs', speed: 1 });

    expect(JSON.parse((fetchMock.mock.calls[0] as any)[1].body).voice_settings).toBeUndefined();
  });
});
