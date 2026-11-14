// @vitest-environment node
import { AgentRuntimeErrorType } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ModelRuntime } from '../../core/ModelRuntime';
import { providerRuntimeMap } from '../../runtimeMap';
import { getModelPricing } from '../../utils/getModelPricing';
import { LobeFishAudioAI } from './index';

vi.mock('../../utils/getModelPricing', () => ({ getModelPricing: vi.fn() }));

describe('LobeFishAudioAI', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(getModelPricing).mockResolvedValue({
      units: [{ name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionCharacters' }],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it.each([undefined, '', '   '])('throws InvalidProviderAPIKey when the key is %j', (apiKey) => {
      expect(() => new LobeFishAudioAI({ apiKey })).toThrow(
        expect.objectContaining({ errorType: AgentRuntimeErrorType.InvalidProviderAPIKey }),
      );
    });

    it('throws InvalidProviderAPIKey when constructed with no options', () => {
      expect(() => new LobeFishAudioAI()).toThrow(
        expect.objectContaining({ errorType: AgentRuntimeErrorType.InvalidProviderAPIKey }),
      );
    });

    it('defaults to the Fish Audio API host and accepts an override', () => {
      expect(new LobeFishAudioAI({ apiKey: 'k' }).baseURL).toBe('https://api.fish.audio');
      expect(
        new LobeFishAudioAI({ apiKey: 'k', baseURL: 'https://proxy.example.com/' }).baseURL,
      ).toBe('https://proxy.example.com');
    });
  });

  it('synthesizes through the configured host with the trimmed key', async () => {
    const runtime = new LobeFishAudioAI({
      apiKey: '  fish-key  ',
      baseURL: 'https://proxy.example.com',
    });

    const result = await runtime.textToSpeech({
      input: 'Hello',
      model: 's2.1-pro',
      voice: 'default',
    });

    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toBe('https://proxy.example.com/v1/tts');
    expect(init.headers.Authorization).toBe('Bearer fish-key');
    expect(result.format).toBe('mp3');
    expect(result.usage).toEqual({ cost: 0.000075, inputCharacters: 5 });
  });

  it('uses its provider id for pricing, overridable for custom providers', async () => {
    await new LobeFishAudioAI({ apiKey: 'k', id: 'my-fish' }).textToSpeech({
      input: 'Hi',
      model: 's2.1-pro',
      voice: 'default',
    });

    expect(getModelPricing).toHaveBeenCalledWith('s2.1-pro', 'my-fish', undefined);
  });

  describe('via ModelRuntime', () => {
    it("is registered in the runtime map under 'fishaudio'", () => {
      expect(providerRuntimeMap.fishaudio).toBe(LobeFishAudioAI);
    });

    it("initializes from the provider id 'fishaudio' instead of falling back to OpenAI", () => {
      const runtime = ModelRuntime.initializeWithProvider('fishaudio', { apiKey: 'fish-key' });

      expect(runtime['_runtime']).toBeInstanceOf(LobeFishAudioAI);
    });

    it('rejects initialization without an API key', () => {
      expect(() => ModelRuntime.initializeWithProvider('fishaudio', {})).toThrow(
        expect.objectContaining({ errorType: AgentRuntimeErrorType.InvalidProviderAPIKey }),
      );
    });

    it('runs textToSpeech end to end and reports usage to the final hook', async () => {
      const onTextToSpeechFinal = vi.fn();
      const runtime = ModelRuntime.initializeWithProvider(
        'fishaudio',
        { apiKey: 'fish-key' },
        { onTextToSpeechFinal },
      );

      const result = await runtime.textToSpeech(
        { input: 'Hello', model: 's2.1-pro', params: { format: 'opus' }, voice: 'default' },
        { metadata: { trigger: 'tts' } },
      );

      expect(new Uint8Array(result!.audio)).toEqual(new Uint8Array([1, 2, 3]));
      expect(result!.format).toBe('opus');
      expect(onTextToSpeechFinal).toHaveBeenCalledWith(
        expect.objectContaining({ usage: { cost: 0.000075, inputCharacters: 5 } }),
        expect.anything(),
      );
    });

    it('surfaces upstream errors through the error hook instead of failing silently', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Invalid token', status: 401 }), { status: 401 }),
      );
      const onTextToSpeechError = vi.fn();
      const runtime = ModelRuntime.initializeWithProvider(
        'fishaudio',
        { apiKey: 'bad' },
        { onTextToSpeechError },
      );

      await expect(
        runtime.textToSpeech({ input: 'Hi', model: 's2.1-pro', voice: 'default' }),
      ).rejects.toMatchObject({ errorType: AgentRuntimeErrorType.InvalidProviderAPIKey });
      expect(onTextToSpeechError).toHaveBeenCalledWith(
        expect.objectContaining({ errorType: AgentRuntimeErrorType.InvalidProviderAPIKey }),
        expect.anything(),
      );
    });
  });
});
