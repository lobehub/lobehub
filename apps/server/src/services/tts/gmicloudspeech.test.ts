// @vitest-environment node
/**
 * TTSService -> initModelRuntimeFromDB -> ModelRuntime -> LobeGmicloudSpeechAI -> fetch,
 * with only the provider row, the server env and the network mocked, so
 * provider='gmicloudspeech' runs through the same code a tRPC / OpenAPI request does.
 */
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

const { TTSService } = await import('./index');

const DEFAULT_VOICE = 'Dennis';
const AUDIO = new Uint8Array([0x49, 0x44, 0x33, 0x04]);
const QUEUE_URL = 'https://console.gmicloud.ai/api/v1/ie/requestqueue/apikey/requests';

const service = new TTSService({} as any, 'user-1');

const queueSuccess = (audioUrl = 'https://a/x.mp3') =>
  new Response(
    JSON.stringify({ outcome: { audio_url: audioUrl }, request_id: 'r', status: 'success' }),
    { headers: { 'content-type': 'application/json' } },
  );

describe('TTSService with provider gmicloudspeech', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    providerRow.current = { keyVaults: { apiKey: 'user-gmi-key' } };
    llmConfig.current = {};
    fetchMock = vi.fn(async (url: string) =>
      url.startsWith(QUEUE_URL)
        ? queueSuccess()
        : new Response(AUDIO, { headers: { 'content-type': 'audio/mpeg' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('synthesizes with the key saved in the provider settings', async () => {
    const result = await service.synthesize({
      input: 'Hello world',
      model: 'inworld-tts-2',
      params: { format: 'mp3', speed: 1.1 },
      provider: 'gmicloudspeech',
      voice: 'Dennis',
    });

    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toBe(QUEUE_URL);
    expect(init.headers.Authorization).toBe('Bearer user-gmi-key');
    expect(JSON.parse(init.body)).toEqual({
      model: 'inworld-tts-2',
      payload: {
        audio_encoding: 'MP3',
        speaking_rate: 1.1,
        text: 'Hello world',
        voice_id: 'Dennis',
      },
    });

    expect(new Uint8Array(result.audio)).toEqual(AUDIO);
    expect(result.format).toBe('mp3');
    expect(result.mimeType).toBe('audio/mpeg');
    expect(result.usage?.inputCharacters).toBe(11);
  });

  it("defaults the voice to the model card's family default", async () => {
    await service.synthesize({
      input: 'Hi',
      model: 'minimax-tts-speech-2.8-turbo',
      provider: 'gmicloudspeech',
    });

    const body = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
    expect(body.model).toBe('minimax-tts-speech-2.8-turbo');
    expect(body.payload.voice_id).toBe('English_expressive_narrator');
  });

  it('falls back to GMICLOUDSPEECH_API_KEY when the user saved no key', async () => {
    providerRow.current = undefined;
    llmConfig.current = { GMICLOUDSPEECH_API_KEY: 'server-gmi-key' };

    await service.synthesize({ input: 'Hi', model: 'inworld-tts-2', provider: 'gmicloudspeech' });

    expect((fetchMock.mock.calls[0] as any)[1].headers.Authorization).toBe('Bearer server-gmi-key');
  });

  it('resolves queued generations by polling', async () => {
    vi.useFakeTimers();
    let poll = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith(`${QUEUE_URL}/r`)) {
        poll += 1;
        return poll < 2
          ? new Response(JSON.stringify({ request_id: 'r', status: 'processing' }), {
              headers: { 'content-type': 'application/json' },
            })
          : queueSuccess();
      }
      if (url.startsWith(QUEUE_URL)) {
        return new Response(JSON.stringify({ request_id: 'r', status: 'dispatched' }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(AUDIO, { headers: { 'content-type': 'audio/mpeg' } });
    });

    const promise = service.synthesize({
      input: 'Hi',
      model: 'minimax-tts-speech-2.8-turbo',
      provider: 'gmicloudspeech',
      voice: 'English_expressive_narrator',
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(poll).toBe(2);
    expect(new Uint8Array(result.audio)).toEqual(AUDIO);
  });

  it('fails with a readable InvalidProviderAPIKey error when no key is configured', async () => {
    providerRow.current = { keyVaults: {} };

    const error = await service
      .synthesize({ input: 'Hi', model: 'inworld-tts-2', provider: 'gmicloudspeech' })
      .catch((e) => e);

    expect(error).toBeDefined();
    expect(JSON.stringify(error)).toContain('InvalidProviderAPIKey');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
