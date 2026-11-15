// @vitest-environment node
import { AgentRuntimeErrorType } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ModelRuntime } from '../../core/ModelRuntime';
import { providerRuntimeMap } from '../../runtimeMap';
import { getModelPricing } from '../../utils/getModelPricing';
import { LobeDoubaoSpeechAI } from './index';

vi.mock('../../utils/getModelPricing', () => ({ getModelPricing: vi.fn() }));

const VOICE = 'zh_female_vv_uranus_bigtts';

const streamResponse = () =>
  new Response(
    [
      JSON.stringify({ code: 0, data: Buffer.from([1, 2, 3]).toString('base64') }),
      JSON.stringify({ code: 20_000_000, message: 'ok', usage: { text_words: 5 } }),
    ].join('\n'),
  );

describe('LobeDoubaoSpeechAI', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => streamResponse());
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(getModelPricing).mockResolvedValue({
      currency: 'CNY',
      units: [{ name: 'textInput', rate: 300, strategy: 'fixed', unit: 'millionCharacters' }],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it.each([
      ['no options', undefined],
      ['an empty key', { apiKey: '  ' }],
      ['an App ID without its Access Token', { appId: 'app' }],
      ['an Access Token without its App ID', { accessToken: 'token' }],
    ])('throws InvalidProviderAPIKey with %s', (_, params) => {
      expect(() => new LobeDoubaoSpeechAI(params)).toThrow(
        expect.objectContaining({ errorType: AgentRuntimeErrorType.InvalidProviderAPIKey }),
      );
    });

    it('accepts either console credentials', () => {
      expect(() => new LobeDoubaoSpeechAI({ apiKey: 'k' })).not.toThrow();
      expect(() => new LobeDoubaoSpeechAI({ accessToken: 't', appId: 'a' })).not.toThrow();
    });

    it('defaults to the openspeech host and accepts an override', () => {
      expect(new LobeDoubaoSpeechAI({ apiKey: 'k' }).baseURL).toBe(
        'https://openspeech.bytedance.com',
      );
      expect(
        new LobeDoubaoSpeechAI({ apiKey: 'k', baseURL: 'https://proxy.example.com/' }).baseURL,
      ).toBe('https://proxy.example.com');
    });
  });

  it('synthesizes with the legacy credentials through the configured host', async () => {
    const runtime = new LobeDoubaoSpeechAI({
      accessToken: 'token',
      appId: 'app',
      baseURL: 'https://proxy.example.com',
    });

    const result = await runtime.textToSpeech({
      input: 'Hello',
      model: 'seed-tts-2.0',
      voice: VOICE,
    });

    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toBe('https://proxy.example.com/api/v3/tts/unidirectional');
    expect(init.headers['X-Api-App-Id']).toBe('app');
    expect(init.headers['X-Api-Access-Key']).toBe('token');
    expect(result.format).toBe('mp3');
    expect(result.usage?.inputCharacters).toBe(5);
  });

  it('uses its provider id for pricing, overridable for custom providers', async () => {
    await new LobeDoubaoSpeechAI({ apiKey: 'k', id: 'my-doubao' }).textToSpeech({
      input: 'Hi',
      model: 'seed-tts-2.0',
      voice: VOICE,
    });

    expect(getModelPricing).toHaveBeenCalledWith('seed-tts-2.0', 'my-doubao', undefined);
  });

  describe('via ModelRuntime', () => {
    it("is registered in the runtime map under 'doubaospeech'", () => {
      expect(providerRuntimeMap.doubaospeech).toBe(LobeDoubaoSpeechAI);
    });

    it("initializes from the provider id 'doubaospeech' instead of falling back to OpenAI", () => {
      const runtime = ModelRuntime.initializeWithProvider('doubaospeech', { apiKey: 'k' });

      expect(runtime['_runtime']).toBeInstanceOf(LobeDoubaoSpeechAI);
    });

    it('rejects initialization without credentials', () => {
      expect(() => ModelRuntime.initializeWithProvider('doubaospeech', {})).toThrow(
        expect.objectContaining({ errorType: AgentRuntimeErrorType.InvalidProviderAPIKey }),
      );
    });

    it('runs textToSpeech end to end and reports usage to the final hook', async () => {
      const onTextToSpeechFinal = vi.fn();
      const runtime = ModelRuntime.initializeWithProvider(
        'doubaospeech',
        { apiKey: 'k' },
        { onTextToSpeechFinal },
      );

      const result = await runtime.textToSpeech(
        { input: 'Hello', model: 'seed-tts-2.0', voice: VOICE },
        { metadata: { trigger: 'tts' } },
      );

      expect(new Uint8Array(result!.audio)).toEqual(new Uint8Array([1, 2, 3]));
      expect(onTextToSpeechFinal).toHaveBeenCalledWith(
        expect.objectContaining({ usage: expect.objectContaining({ inputCharacters: 5 }) }),
        expect.anything(),
      );
    });

    it('surfaces upstream errors through the error hook instead of failing silently', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 45_000_000, message: 'requested grant not found' }), {
          status: 401,
        }),
      );
      const onTextToSpeechError = vi.fn();
      const runtime = ModelRuntime.initializeWithProvider(
        'doubaospeech',
        { apiKey: 'bad' },
        { onTextToSpeechError },
      );

      await expect(
        runtime.textToSpeech({ input: 'Hi', model: 'seed-tts-2.0', voice: VOICE }),
      ).rejects.toMatchObject({ errorType: AgentRuntimeErrorType.InvalidProviderAPIKey });
      expect(onTextToSpeechError).toHaveBeenCalledWith(
        expect.objectContaining({ errorType: AgentRuntimeErrorType.InvalidProviderAPIKey }),
        expect.anything(),
      );
    });
  });
});
