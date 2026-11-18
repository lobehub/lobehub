// @vitest-environment node
import { AgentRuntimeErrorType } from '@lobechat/types';
import type { Pricing } from 'model-bank';
import { DOUBAO_SPEECH_DEFAULT_VOICE_ID } from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getModelPricing } from '../../utils/getModelPricing';
import {
  buildDoubaoSpeechAuthHeaders,
  buildDoubaoSpeechRequest,
  createDoubaoSpeech,
  DOUBAO_SPEECH_MAX_INPUT_CHARACTERS,
  type DoubaoSpeechOptions,
  normalizeDoubaoSpeechBaseURL,
  readDoubaoSpeechFrames,
} from './createSpeech';

vi.mock('../../utils/getModelPricing', () => ({ getModelPricing: vi.fn() }));

// 3 CNY per 10k characters, as on the seed-tts-2.0 card
const seed20Pricing: Pricing = {
  currency: 'CNY',
  units: [{ name: 'textInput', rate: 300, strategy: 'fixed', unit: 'millionCharacters' }],
};

const options: DoubaoSpeechOptions = {
  apiKey: 'doubao-test-key',
  baseURL: 'https://openspeech.bytedance.com',
  provider: 'doubaospeech',
};

const VOICE = 'zh_male_m191_uranus_bigtts';

const b64 = (bytes: number[]) => Buffer.from(Uint8Array.from(bytes)).toString('base64');

/** A V3 chunked response: audio frames, then the 20000000 frame. */
const streamResponse = (
  frames: unknown[] = [
    { code: 0, data: b64([1, 2]), message: '' },
    { code: 0, data: b64([3]), message: '' },
    { code: 20_000_000, data: null, message: 'ok', usage: { text_words: 7 } },
  ],
  status = 200,
) =>
  new Response(frames.map((frame) => JSON.stringify(frame)).join('\n'), {
    headers: { 'content-type': 'application/json', 'x-tt-logid': 'log-1' },
    status,
  });

const lastRequest = (fetchMock: ReturnType<typeof vi.fn>) => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return {
    body: JSON.parse(init.body as string),
    headers: init.headers as Record<string, string>,
    url,
  };
};

describe('createDoubaoSpeech', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => streamResponse());
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(getModelPricing).mockResolvedValue(seed20Pricing);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('posts a V3 request with the API key and the model as resource id', async () => {
    const result = await createDoubaoSpeech(
      { input: '你好', model: 'seed-tts-2.0', voice: VOICE },
      { ...options, user: 'user_1' },
    );

    const { body, headers, url } = lastRequest(fetchMock);
    expect(url).toBe('https://openspeech.bytedance.com/api/v3/tts/unidirectional');
    expect(headers['X-Api-Key']).toBe('doubao-test-key');
    expect(headers['X-Api-App-Id']).toBeUndefined();
    expect(headers['X-Api-Resource-Id']).toBe('seed-tts-2.0');
    expect(headers['X-Api-Request-Id']).toMatch(/^[\da-f-]{36}$/);
    expect(headers['X-Control-Require-Usage-Tokens-Return']).toBe('text_words');
    expect(body).toEqual({
      req_params: { audio_params: { format: 'mp3' }, speaker: VOICE, text: '你好' },
      user: { uid: expect.stringMatching(/^[\da-f]{32}$/) },
    });
    // The raw user id never leaves the server.
    expect(JSON.stringify(body)).not.toContain('user_1');
    expect(new Uint8Array(result.audio)).toEqual(new Uint8Array([1, 2, 3]));
    expect(result.format).toBe('mp3');
  });

  it('authenticates with the legacy App ID + Access Token', async () => {
    await createDoubaoSpeech(
      { input: 'Hi', model: 'seed-tts-2.0', voice: VOICE },
      { ...options, accessToken: 'token-1', apiKey: undefined, appId: 'app-1' },
    );

    const { headers } = lastRequest(fetchMock);
    expect(headers['X-Api-App-Id']).toBe('app-1');
    expect(headers['X-Api-Access-Key']).toBe('token-1');
    expect(headers['X-Api-Key']).toBeUndefined();
  });

  it('maps speed, volume, pitch, sample rate and format', async () => {
    await createDoubaoSpeech(
      {
        input: 'Hi',
        model: 'seed-tts-2.0',
        params: { format: 'wav', pitch: 3, sampleRate: 16_000, speed: 1.5, volume: 0.5 },
        voice: VOICE,
      },
      options,
    );

    expect(lastRequest(fetchMock).body.req_params).toEqual({
      additions: JSON.stringify({ post_process: { pitch: 3 } }),
      audio_params: { format: 'wav', loudness_rate: -50, sample_rate: 16_000, speech_rate: 50 },
      speaker: VOICE,
      text: 'Hi',
    });
  });

  it('sends opus as ogg_opus at 48 kHz', async () => {
    for (const sampleRate of [undefined, 48_000]) {
      const result = await createDoubaoSpeech(
        {
          input: 'Hi',
          model: 'seed-tts-2.0',
          params: { format: 'opus', sampleRate },
          voice: VOICE,
        },
        options,
      );

      expect(lastRequest(fetchMock).body.req_params.audio_params).toEqual({
        format: 'ogg_opus',
        sample_rate: 48_000,
      });
      expect(result.format).toBe('opus');
    }
  });

  it('refuses an opus request at a rate other than 48 kHz before calling Doubao', async () => {
    await expect(
      createDoubaoSpeech(
        {
          input: 'Hi',
          model: 'seed-tts-2.0',
          params: { format: 'opus', sampleRate: 24_000 },
          voice: VOICE,
        },
        options,
      ),
    ).rejects.toMatchObject({
      error: { message: expect.stringContaining('only produced at 48000 Hz') },
      errorType: AgentRuntimeErrorType.ProviderBizError,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('replaces a service-filled default voice of another vendor with the Doubao default', async () => {
    await createDoubaoSpeech(
      { input: 'Hi', model: 'seed-tts-2.0', voice: 'alloy', voiceIsDefault: true },
      options,
    );

    expect(lastRequest(fetchMock).body.req_params.speaker).toBe(DOUBAO_SPEECH_DEFAULT_VOICE_ID);
  });

  it('speaks a voice clone through the voice-cloning resource, priced as the model', async () => {
    await createDoubaoSpeech({ input: 'Hi', model: 'seed-tts-2.0', voice: 'S_abc123' }, options);

    const { body, headers } = lastRequest(fetchMock);
    expect(body.req_params.speaker).toBe('S_abc123');
    expect(headers['X-Api-Resource-Id']).toBe('seed-icl-2.0');
    expect(getModelPricing).toHaveBeenCalledWith('seed-tts-2.0', 'doubaospeech', undefined);
  });

  it('keeps the synthesis resource for official voices', async () => {
    await createDoubaoSpeech({ input: 'Hi', model: 'seed-tts-2.0', voice: VOICE }, options);

    expect(lastRequest(fetchMock).headers['X-Api-Resource-Id']).toBe('seed-tts-2.0');
  });

  it('bills the billed text_words in CNY, converted to USD', async () => {
    const onUsage = vi.fn();
    const result = await createDoubaoSpeech(
      { input: 'Hello', model: 'seed-tts-2.0', voice: VOICE },
      { ...options, onUsage },
    );

    expect(result.usage?.inputCharacters).toBe(7);
    expect(result.usage?.cost).toBeGreaterThan(0);
    expect(onUsage).toHaveBeenCalledWith(result.usage);
  });

  it('falls back to the local character count without usage', async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        { code: 0, data: b64([9]) },
        { code: 20_000_000, message: 'ok' },
      ]),
    );

    const result = await createDoubaoSpeech(
      { input: '你好呀', model: 'seed-tts-2.0', voice: VOICE },
      options,
    );

    expect(result.usage?.inputCharacters).toBe(3);
  });

  it('honours the model id mapping and normalizes the base URL', async () => {
    await createDoubaoSpeech(
      { input: 'Hi', model: 'doubao-tts', voice: VOICE },
      {
        ...options,
        baseURL: 'https://proxy.example.com/api/v3/',
        modelIdMapping: { 'doubao-tts': 'seed-tts-2.0' },
      },
    );

    const { headers, url } = lastRequest(fetchMock);
    expect(url).toBe('https://proxy.example.com/api/v3/tts/unidirectional');
    expect(headers['X-Api-Resource-Id']).toBe('seed-tts-2.0');
    expect(getModelPricing).toHaveBeenCalledWith('doubao-tts', 'doubaospeech', undefined);
  });

  it('prices an unpriced alias by the model it maps to', async () => {
    vi.mocked(getModelPricing).mockImplementation(async (model) =>
      model === 'seed-tts-2.0' ? seed20Pricing : undefined,
    );

    const result = await createDoubaoSpeech(
      { input: 'Hi', model: 'doubao-tts', voice: VOICE },
      { ...options, modelIdMapping: { 'doubao-tts': 'seed-tts-2.0' } },
    );

    expect(getModelPricing).toHaveBeenCalledWith('seed-tts-2.0', 'doubaospeech', undefined);
    expect(result.usage?.cost).toBeGreaterThan(0);
  });

  it("validates a mapped alias against the resolved model's card", async () => {
    await expect(
      createDoubaoSpeech(
        { input: 'Hi', model: 'doubao-tts', params: { speed: 100 }, voice: VOICE },
        { ...options, modelIdMapping: { 'doubao-tts': 'seed-tts-2.0' } },
      ),
    ).rejects.toMatchObject({
      error: { message: expect.stringContaining('params.speed') },
      errorType: AgentRuntimeErrorType.ProviderBizError,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('rejects before calling Doubao Speech', () => {
    it('without credentials', async () => {
      await expect(
        createDoubaoSpeech(
          { input: 'Hi', model: 'seed-tts-2.0', voice: VOICE },
          { ...options, apiKey: undefined, appId: 'app-only' },
        ),
      ).rejects.toMatchObject({ errorType: AgentRuntimeErrorType.InvalidProviderAPIKey });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
      ['an unsupported format', { params: { format: 'aac' as const } }],
      ['an empty voice', { voice: ' ' }],
      ['empty input', { input: '  ' }],
      ['input over the limit', { input: 'a'.repeat(DOUBAO_SPEECH_MAX_INPUT_CHARACTERS + 1) }],
      ['an unknown model', { model: 'seed-tts-9.9' }],
    ])('%s', async (_, override) => {
      await expect(
        createDoubaoSpeech(
          { input: 'Hi', model: 'seed-tts-2.0', voice: VOICE, ...override },
          options,
        ),
      ).rejects.toMatchObject({ errorType: AgentRuntimeErrorType.ProviderBizError });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it.each(['seed-tts-1.0', 'seed-tts-1.0-concurr', 'seed-icl-2.0'])(
    'passes the documented resource %s through',
    async (model) => {
      await createDoubaoSpeech({ input: 'Hi', model, voice: VOICE }, options);

      expect(lastRequest(fetchMock).headers['X-Api-Resource-Id']).toBe(model);
    },
  );

  describe('maps upstream errors', () => {
    it.each([
      [
        401,
        { code: 45_000_010, message: 'invalid api key' },
        AgentRuntimeErrorType.InvalidProviderAPIKey,
      ],
      [
        403,
        { code: 45_000_000, message: 'requested grant not found' },
        AgentRuntimeErrorType.InvalidProviderAPIKey,
      ],
      [
        403,
        { code: 45_000_000, message: 'speaker permission denied: access denied' },
        AgentRuntimeErrorType.PermissionDenied,
      ],
      [
        429,
        { code: 45_000_000, message: 'quota exceeded for types: concurrency' },
        AgentRuntimeErrorType.RateLimitExceeded,
      ],
      [
        403,
        { code: 45_000_000, message: 'quota exceeded for types: tts_lifetime' },
        AgentRuntimeErrorType.InsufficientQuota,
      ],
      [
        400,
        { code: 40_402_003, message: 'TTSExceededTextLimit' },
        AgentRuntimeErrorType.ProviderBizError,
      ],
      [
        500,
        { code: 55_000_000, message: 'internal error' },
        AgentRuntimeErrorType.ProviderBizError,
      ],
    ])('HTTP %d %o → %s', async (status, frame, errorType) => {
      fetchMock.mockResolvedValueOnce(streamResponse([frame], status));

      await expect(
        createDoubaoSpeech({ input: 'Hi', model: 'seed-tts-2.0', voice: VOICE }, options),
      ).rejects.toMatchObject({
        error: {
          code: frame.code,
          logId: 'log-1',
          message: expect.stringContaining(frame.message),
          status,
        },
        errorType,
        provider: 'doubaospeech',
      });
    });

    it('falls back to the HTTP status for a non-JSON error body', async () => {
      fetchMock.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

      await expect(
        createDoubaoSpeech({ input: 'Hi', model: 'seed-tts-2.0', voice: VOICE }, options),
      ).rejects.toMatchObject({
        error: { message: 'Doubao Speech API error (401): Unauthorized' },
        errorType: AgentRuntimeErrorType.InvalidProviderAPIKey,
      });
    });

    it('explains a voice that does not match the model version', async () => {
      fetchMock.mockResolvedValueOnce(
        streamResponse(
          [{ code: 55_000_000, message: 'resource ID is mismatched with speaker' }],
          400,
        ),
      );

      await expect(
        createDoubaoSpeech(
          { input: 'Hi', model: 'seed-tts-2.0', voice: 'zh_x_moon_bigtts' },
          options,
        ),
      ).rejects.toMatchObject({
        error: { message: expect.stringContaining('does not belong to this model version') },
      });
    });

    it('fails on an error frame inside a 200 stream', async () => {
      fetchMock.mockResolvedValueOnce(
        streamResponse([
          { code: 0, data: b64([1]) },
          { code: 45_002_001, message: 'no valid text' },
        ]),
      );

      await expect(
        createDoubaoSpeech({ input: 'Hi', model: 'seed-tts-2.0', voice: VOICE }, options),
      ).rejects.toMatchObject({
        error: { code: 45_002_001, message: expect.stringContaining('no valid text') },
        errorType: AgentRuntimeErrorType.ProviderBizError,
      });
    });

    it('fails on a stream cut before the final frame instead of billing it', async () => {
      const onUsage = vi.fn();
      fetchMock.mockResolvedValueOnce(streamResponse([{ code: 0, data: b64([1]) }]));

      await expect(
        createDoubaoSpeech(
          { input: 'Hi', model: 'seed-tts-2.0', voice: VOICE },
          { ...options, onUsage },
        ),
      ).rejects.toMatchObject({
        error: { message: 'Doubao Speech response ended before the synthesis finished' },
      });
      expect(onUsage).not.toHaveBeenCalled();
    });

    it('fails on a finished stream without audio', async () => {
      fetchMock.mockResolvedValueOnce(streamResponse([{ code: 20_000_000, message: 'ok' }]));

      await expect(
        createDoubaoSpeech({ input: 'Hi', model: 'seed-tts-2.0', voice: VOICE }, options),
      ).rejects.toMatchObject({ error: { message: 'Doubao Speech returned empty audio' } });
    });

    it('rethrows aborts as is', async () => {
      const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
      fetchMock.mockRejectedValueOnce(abort);

      await expect(
        createDoubaoSpeech({ input: 'Hi', model: 'seed-tts-2.0', voice: VOICE }, options),
      ).rejects.toBe(abort);
    });
  });
});

describe('Doubao Speech helpers', () => {
  it('prefers the API key over the legacy credentials', () => {
    expect(buildDoubaoSpeechAuthHeaders({ accessToken: 't', apiKey: ' k ', appId: 'a' })).toEqual({
      'X-Api-Key': 'k',
    });
    expect(buildDoubaoSpeechAuthHeaders({ accessToken: 't', appId: 'a' })).toEqual({
      'X-Api-Access-Key': 't',
      'X-Api-App-Id': 'a',
    });
    expect(buildDoubaoSpeechAuthHeaders({ appId: 'a' })).toBeUndefined();
    expect(buildDoubaoSpeechAuthHeaders({ apiKey: '  ' })).toBeUndefined();
  });

  it('normalizes the base URL', () => {
    expect(normalizeDoubaoSpeechBaseURL()).toBe('https://openspeech.bytedance.com');
    expect(normalizeDoubaoSpeechBaseURL('https://x.example.com/api/v3')).toBe(
      'https://x.example.com',
    );
  });

  it('sends no pitch addition at the neutral pitch', () => {
    const { body } = buildDoubaoSpeechRequest(
      { input: 'Hi', model: 'seed-tts-2.0', params: { pitch: 0 }, voice: VOICE },
      'uid',
    );

    expect(body.req_params).not.toHaveProperty('additions');
  });

  it('reads frames written back to back', () => {
    const body = `${JSON.stringify({ code: 0, data: b64([7]) })}${JSON.stringify({ code: 20_000_000 })}`;

    expect(new Uint8Array(readDoubaoSpeechFrames(body, 200).audio)).toEqual(new Uint8Array([7]));
  });

  it('does not split a frame on braces inside a string', () => {
    const body = [
      JSON.stringify({ code: 0, data: b64([7]) }),
      JSON.stringify({ code: 45_000_001, message: 'bad req_params}{"x":1}' }),
    ].join('');

    expect(() => readDoubaoSpeechFrames(body, 200)).toThrow('bad req_params}{"x":1}');
  });

  it('rejects an unreadable frame', () => {
    expect(() => readDoubaoSpeechFrames('not json', 200)).toThrow('unreadable response frame');
  });
});
