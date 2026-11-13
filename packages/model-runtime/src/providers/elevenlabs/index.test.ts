// @vitest-environment node
import { AgentRuntimeErrorType } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ModelRuntime } from '../../core/ModelRuntime';
import { providerRuntimeMap } from '../../runtimeMap';
import { getModelPricing } from '../../utils/getModelPricing';
import { LobeElevenLabsAI } from './index';

vi.mock('../../utils/getModelPricing', () => ({ getModelPricing: vi.fn() }));

const VOICE = 'OZ0L6eISlOejga3XjDFt';

describe('LobeElevenLabsAI', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'content-type': 'audio/mpeg', 'character-cost': '2' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(getModelPricing).mockResolvedValue({
      units: [{ name: 'textInput', rate: 40, strategy: 'fixed', unit: 'millionCharacters' }],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it.each([undefined, '', '   '])(
      'throws InvalidProviderAPIKey when the API key is %j',
      (apiKey) => {
        expect(() => new LobeElevenLabsAI({ apiKey })).toThrow(
          expect.objectContaining({ errorType: AgentRuntimeErrorType.InvalidProviderAPIKey }),
        );
      },
    );

    it('throws InvalidProviderAPIKey when constructed with no options', () => {
      expect(() => new LobeElevenLabsAI()).toThrow(
        expect.objectContaining({ errorType: AgentRuntimeErrorType.InvalidProviderAPIKey }),
      );
    });

    it('defaults to the global API host and accepts an override', () => {
      expect(new LobeElevenLabsAI({ apiKey: 'k' }).baseURL).toBe('https://api.elevenlabs.io');
      expect(
        new LobeElevenLabsAI({ apiKey: 'k', baseURL: 'https://api.eu.residency.elevenlabs.io/' })
          .baseURL,
      ).toBe('https://api.eu.residency.elevenlabs.io');
    });
  });

  it('synthesizes through the configured host with the trimmed key', async () => {
    const runtime = new LobeElevenLabsAI({
      apiKey: '  xi-key  ',
      baseURL: 'https://proxy.example.com',
    });

    const result = await runtime.textToSpeech({
      input: 'Hello',
      model: 'eleven_flash_v2_5',
      voice: VOICE,
    });

    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toBe(
      `https://proxy.example.com/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`,
    );
    expect(init.headers['xi-api-key']).toBe('xi-key');
    expect(result.format).toBe('mp3');
    expect(result.usage).toEqual({ cost: 0.0002, inputCharacters: 5 });
  });

  it('uses its provider id for pricing and errors, overridable for custom providers', async () => {
    await new LobeElevenLabsAI({ apiKey: 'k', id: 'my-elevenlabs' }).textToSpeech({
      input: 'Hi',
      model: 'eleven_v4',
      voice: VOICE,
    });

    expect(getModelPricing).toHaveBeenCalledWith('eleven_v4', 'my-elevenlabs', undefined);
  });

  describe('via ModelRuntime', () => {
    it("is registered in the runtime map under 'elevenlabs'", () => {
      expect(providerRuntimeMap.elevenlabs).toBe(LobeElevenLabsAI);
    });

    it("initializes from the provider id 'elevenlabs' instead of falling back to OpenAI", () => {
      const runtime = ModelRuntime.initializeWithProvider('elevenlabs', { apiKey: 'xi-key' });

      expect(runtime['_runtime']).toBeInstanceOf(LobeElevenLabsAI);
    });

    it('rejects initialization without an API key', () => {
      expect(() => ModelRuntime.initializeWithProvider('elevenlabs', {})).toThrow(
        expect.objectContaining({ errorType: AgentRuntimeErrorType.InvalidProviderAPIKey }),
      );
    });

    it('runs textToSpeech end to end and reports usage to the final hook', async () => {
      const onTextToSpeechFinal = vi.fn();
      const runtime = ModelRuntime.initializeWithProvider(
        'elevenlabs',
        { apiKey: 'xi-key' },
        { onTextToSpeechFinal },
      );

      const result = await runtime.textToSpeech(
        { input: 'Hello', model: 'eleven_flash_v2_5', params: { format: 'opus' }, voice: VOICE },
        { metadata: { trigger: 'tts' } },
      );

      expect(new Uint8Array(result!.audio)).toEqual(new Uint8Array([1, 2, 3]));
      expect(result!.format).toBe('opus');
      expect(fetchMock.mock.calls[0][0]).toContain('output_format=opus_48000_128');
      expect(onTextToSpeechFinal).toHaveBeenCalledWith(
        expect.objectContaining({ usage: { cost: 0.0002, inputCharacters: 5 } }),
        expect.anything(),
      );
    });

    it('surfaces upstream errors through the error hook instead of failing silently', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ detail: { message: 'Invalid API key', status: 'invalid_api_key' } }),
          {
            status: 401,
          },
        ),
      );
      const onTextToSpeechError = vi.fn();
      const runtime = ModelRuntime.initializeWithProvider(
        'elevenlabs',
        { apiKey: 'bad' },
        { onTextToSpeechError },
      );

      await expect(
        runtime.textToSpeech({ input: 'Hi', model: 'eleven_v4', voice: VOICE }),
      ).rejects.toMatchObject({ errorType: AgentRuntimeErrorType.InvalidProviderAPIKey });
      expect(onTextToSpeechError).toHaveBeenCalledWith(
        expect.objectContaining({ errorType: AgentRuntimeErrorType.InvalidProviderAPIKey }),
        expect.anything(),
      );
    });
  });
});
