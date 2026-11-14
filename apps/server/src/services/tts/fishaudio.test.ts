// @vitest-environment node
/**
 * TTSService → initModelRuntimeFromDB → ModelRuntime → LobeFishAudioAI → fetch, with only
 * the provider row, the server env and the network mocked, so provider='fishaudio' runs
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

const VOICE = '0123456789abcdef0123456789abcdef';
const AUDIO = new Uint8Array([0x49, 0x44, 0x33, 0x04]);

const service = new TTSService({} as any, 'user-1');

describe('TTSService with provider fishaudio', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    providerRow.current = { keyVaults: { apiKey: 'user-fish-key' } };
    llmConfig.current = {};
    fetchMock = vi.fn(
      async () => new Response(AUDIO, { headers: { 'content-type': 'audio/mpeg' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('synthesizes with the key saved in the provider settings', async () => {
    const result = await service.synthesize({
      input: '你好 world',
      model: 's2.1-pro',
      params: { format: 'opus', instructions: 'cheerful', speed: 1.2 },
      provider: 'fishaudio',
      voice: VOICE,
    });

    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toBe('https://api.fish.audio/v1/tts');
    expect(init.headers.Authorization).toBe('Bearer user-fish-key');
    expect(init.headers.model).toBe('s2.1-pro');
    expect(JSON.parse(init.body)).toEqual({
      format: 'opus',
      prosody: { speed: 1.2 },
      reference_id: VOICE,
      text: '[cheerful] 你好 world',
    });

    expect(new Uint8Array(result.audio)).toEqual(AUDIO);
    expect(result.format).toBe('opus');
    expect(result.mimeType).toBe('audio/opus');
    // "[cheerful] " (11) + 6 bytes for two Han characters + " world" (6) at $15 / 1M bytes
    expect(result.usage).toEqual({ cost: 0.000_345, inputCharacters: 23 });
  });

  it("defaults to Fish Audio's own default voice, sending no reference_id", async () => {
    await service.synthesize({ input: 'Hi', model: 'drama-3', provider: 'fishaudio' });

    const [, init] = fetchMock.mock.calls[0] as any;
    expect(init.headers.model).toBe('drama-3');
    expect(JSON.parse(init.body)).toEqual({ format: 'mp3', text: 'Hi' });
  });

  it('falls back to FISHAUDIO_API_KEY and FISHAUDIO_PROXY_URL when the user saved no key', async () => {
    providerRow.current = undefined;
    llmConfig.current = { FISHAUDIO_API_KEY: 'server-fish-key' };
    vi.stubEnv('FISHAUDIO_PROXY_URL', 'https://proxy.example.com/v1');

    await service.synthesize({ input: 'Hi', model: 's2.1-pro', provider: 'fishaudio' });

    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toBe('https://proxy.example.com/v1/tts');
    expect(init.headers.Authorization).toBe('Bearer server-fish-key');
  });

  it('fails with a readable InvalidProviderAPIKey error when no key is configured', async () => {
    providerRow.current = { keyVaults: {} };

    const error = await service
      .synthesize({ input: 'Hi', model: 's2.1-pro', provider: 'fishaudio' })
      .catch((e) => e);

    expect(error).toBeInstanceOf(TTSProviderError);
    expect(error.errorType).toBe(AgentRuntimeErrorType.InvalidProviderAPIKey);
    expect(error.message).toBe(
      'Fish Audio API Key is incorrect or empty, please check your Fish Audio API Key and try again. Set it in Settings → AI Providers → Fish Audio, or in the server environment.',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces an upstream 401 with the InvalidProviderAPIKey copy and the Fish message', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Invalid token', status: 401 }), { status: 401 }),
    );

    const error = await service
      .synthesize({ input: 'Hi', model: 's2.1-pro', provider: 'fishaudio' })
      .catch((e) => e);

    expect(error.errorType).toBe(AgentRuntimeErrorType.InvalidProviderAPIKey);
    expect(error.message).toBe(
      'Fish Audio API Key is incorrect or empty, please check your Fish Audio API Key and try again (Fish Audio API error (401): Invalid token). Set it in Settings → AI Providers → Fish Audio, or in the server environment.',
    );
  });

  it('surfaces an upstream 402 as InsufficientQuota', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'No API credit', status: 402 }), { status: 402 }),
    );

    await expect(
      service.synthesize({ input: 'Hi', model: 's2.1-pro', provider: 'fishaudio' }),
    ).rejects.toMatchObject({
      errorType: AgentRuntimeErrorType.InsufficientQuota,
      message: 'Fish Audio API error (402): No API credit',
    });
  });

  it('accepts a sample rate the format offers and forwards it to Fish', async () => {
    await service.synthesize({
      input: 'Hi',
      model: 's2.1-pro',
      params: { format: 'mp3', sampleRate: 32_000 },
      provider: 'fishaudio',
    });

    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toMatchObject({
      format: 'mp3',
      sample_rate: 32_000,
    });
  });

  it('rejects a sample rate outside the Fish card before calling the API', async () => {
    await expect(
      service.synthesize({
        input: 'Hi',
        model: 's2.1-pro',
        params: { sampleRate: 22_050 },
        provider: 'fishaudio',
      }),
    ).rejects.toMatchObject({ name: 'TTSRequestError', reason: 'invalid_params' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects params the Fish card does not allow before calling the API', async () => {
    for (const params of [
      { speed: 3 },
      { format: 'aac' as const },
      { pitch: 2 },
      { instructions: 'x'.repeat(201) },
    ]) {
      await expect(
        service.synthesize({ input: 'Hi', model: 's2.1-pro', params, provider: 'fishaudio' }),
      ).rejects.toMatchObject({ name: 'TTSRequestError', reason: 'invalid_params' });
    }

    // S1 takes no directions.
    await expect(
      service.synthesize({
        input: 'Hi',
        model: 's1',
        params: { instructions: 'calm' },
        provider: 'fishaudio',
      }),
    ).rejects.toBeInstanceOf(TTSRequestError);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects input over the inline cap before calling the API', async () => {
    await expect(
      service.synthesize({
        input: 'a'.repeat(INLINE_TTS_MAX_INPUT_CHARACTERS + 1),
        model: 's2.1-pro',
        provider: 'fishaudio',
      }),
    ).rejects.toMatchObject({ name: 'TTSRequestError', reason: 'invalid_params' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caps Fish Audio models routed through the LobeHub provider too', async () => {
    await expect(
      service.synthesize({
        input: 'a'.repeat(INLINE_TTS_MAX_INPUT_CHARACTERS + 1),
        model: 'drama-3',
        provider: 'lobehub',
      }),
    ).rejects.toMatchObject({ name: 'TTSRequestError', reason: 'invalid_params' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
