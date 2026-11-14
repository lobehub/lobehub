// @vitest-environment node
import { AgentRuntimeErrorType } from '@lobechat/types';
import type { Pricing } from 'model-bank';
import { FISH_AUDIO_DEFAULT_VOICE_ID } from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getModelPricing } from '../../utils/getModelPricing';
import {
  buildFishAudioSpeechRequest,
  buildFishAudioText,
  countFishAudioBilledBytes,
  createFishAudioSpeech,
  FISH_AUDIO_MAX_INPUT_CHARACTERS,
  FISH_AUDIO_VOICE_HINT,
  type FishAudioSpeechOptions,
  normalizeFishAudioBaseURL,
} from './createSpeech';

vi.mock('../../utils/getModelPricing', () => ({ getModelPricing: vi.fn() }));

// $15 per million UTF-8 bytes, as on the s2.1-pro card
const s21Pricing: Pricing = {
  units: [{ name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionCharacters' }],
};

const options: FishAudioSpeechOptions = {
  apiKey: 'fish-test-key',
  baseURL: 'https://api.fish.audio',
  provider: 'fishaudio',
};

const VOICE = '0123456789abcdef0123456789abcdef';
const AUDIO_BYTES = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00]);

const audioResponse = () =>
  new Response(AUDIO_BYTES, { headers: { 'content-type': 'audio/mpeg' }, status: 200 });

const errorResponse = (status: number, body: unknown, statusText = '') =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    headers: { 'content-type': typeof body === 'string' ? 'text/plain' : 'application/json' },
    status,
    statusText,
  });

const lastRequest = (fetchMock: ReturnType<typeof vi.fn>) => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return {
    body: JSON.parse(init.body as string),
    headers: init.headers as Record<string, string>,
    url,
  };
};

describe('createFishAudioSpeech', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => audioResponse());
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(getModelPricing).mockResolvedValue(s21Pricing);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('posts to /v1/tts with the bearer key and always sends the model header', async () => {
    const result = await createFishAudioSpeech(
      { input: 'Hello', model: 's2.1-pro', voice: VOICE },
      options,
    );

    const { body, headers, url } = lastRequest(fetchMock);
    expect(url).toBe('https://api.fish.audio/v1/tts');
    expect(headers['Authorization']).toBe('Bearer fish-test-key');
    expect(headers['model']).toBe('s2.1-pro');
    expect(headers['Content-Type']).toBe('application/json');
    expect(body).toEqual({ format: 'mp3', reference_id: VOICE, text: 'Hello' });
    expect(new Uint8Array(result.audio)).toEqual(AUDIO_BYTES);
    expect(result.format).toBe('mp3');
  });

  it('omits reference_id for the built-in default voice', async () => {
    await createFishAudioSpeech(
      { input: 'Hi', model: 's2.1-pro', voice: FISH_AUDIO_DEFAULT_VOICE_ID },
      options,
    );

    expect(lastRequest(fetchMock).body).not.toHaveProperty('reference_id');
  });

  it('replaces a service-filled default voice of another vendor with the Fish default', async () => {
    await createFishAudioSpeech(
      { input: 'Hi', model: 's2.1-pro', voice: 'alloy', voiceIsDefault: true },
      options,
    );

    expect(lastRequest(fetchMock).body).not.toHaveProperty('reference_id');
  });

  it('keeps a card default that is a Fish reference id', async () => {
    await createFishAudioSpeech(
      { input: 'Hi', model: 's2.1-pro', voice: VOICE, voiceIsDefault: true },
      options,
    );

    expect(lastRequest(fetchMock).body.reference_id).toBe(VOICE);
  });

  it('maps speed, format and sample rate', async () => {
    const result = await createFishAudioSpeech(
      {
        input: 'Hi',
        model: 's2-pro',
        params: { format: 'opus', sampleRate: 48_000, speed: 1.5 },
        voice: VOICE,
      },
      options,
    );

    expect(lastRequest(fetchMock).body).toEqual({
      format: 'opus',
      prosody: { speed: 1.5 },
      reference_id: VOICE,
      sample_rate: 48_000,
      text: 'Hi',
    });
    expect(result.format).toBe('opus');
  });

  it('reads the deprecated top-level speed', async () => {
    await createFishAudioSpeech(
      { input: 'Hi', model: 's2.1-pro', speed: 0.8, voice: VOICE },
      options,
    );

    expect(lastRequest(fetchMock).body.prosody).toEqual({ speed: 0.8 });
  });

  it('writes instructions as a leading direction and bills it with the text', async () => {
    const result = await createFishAudioSpeech(
      {
        input: '你好',
        model: 'drama-3',
        params: { instructions: 'whisper softly' },
        voice: VOICE,
      },
      options,
    );

    expect(lastRequest(fetchMock).body.text).toBe('[whisper softly] 你好');
    // 17 ASCII bytes for "[whisper softly] " + 3 bytes per Han character
    expect(result.usage?.inputCharacters).toBe(23);
  });

  it('bills UTF-8 bytes: a Han character costs three', async () => {
    const onUsage = vi.fn();
    const result = await createFishAudioSpeech(
      { input: '你好 ok', model: 's2.1-pro', voice: VOICE },
      { ...options, onUsage },
    );

    expect(result.usage).toEqual({ cost: 0.000135, inputCharacters: 9 });
    expect(onUsage).toHaveBeenCalledWith(result.usage);
  });

  it('honours the model id mapping and prices by the public model id', async () => {
    await createFishAudioSpeech(
      { input: 'Hi', model: 'fish-pro', voice: VOICE },
      { ...options, modelIdMapping: { 'fish-pro': 's2.1-pro' } },
    );

    expect(lastRequest(fetchMock).headers['model']).toBe('s2.1-pro');
    expect(getModelPricing).toHaveBeenCalledWith('fish-pro', 'fishaudio', undefined);
  });

  it('prices an unpriced alias by the model it maps to', async () => {
    vi.mocked(getModelPricing).mockImplementation(async (model) =>
      model === 's2.1-pro' ? s21Pricing : undefined,
    );

    const result = await createFishAudioSpeech(
      { input: 'Hi', model: 'fish-pro', voice: VOICE },
      { ...options, modelIdMapping: { 'fish-pro': 's2.1-pro' } },
    );

    expect(getModelPricing).toHaveBeenCalledWith('fish-pro', 'fishaudio', undefined);
    expect(getModelPricing).toHaveBeenCalledWith('s2.1-pro', 'fishaudio', undefined);
    expect(result.usage?.cost).toBeGreaterThan(0);
  });

  it("validates a mapped alias against the resolved model's card", async () => {
    await expect(
      createFishAudioSpeech(
        { input: 'Hi', model: 'fish-pro', params: { speed: 100 }, voice: VOICE },
        { ...options, modelIdMapping: { 'fish-pro': 's2.1-pro' } },
      ),
    ).rejects.toMatchObject({
      error: { message: expect.stringContaining('params.speed') },
      errorType: AgentRuntimeErrorType.ProviderBizError,
    });
    // S1 takes no instructions; s2.1-pro-free follows the S2.1 Pro schema.
    await expect(
      createFishAudioSpeech(
        { input: 'Hi', model: 'fish-s1', params: { instructions: 'calm' }, voice: VOICE },
        { ...options, modelIdMapping: { 'fish-s1': 's1' } },
      ),
    ).rejects.toMatchObject({ errorType: AgentRuntimeErrorType.ProviderBizError });
    await expect(
      createFishAudioSpeech(
        { input: 'Hi', model: 'free', params: { speed: 3 }, voice: VOICE },
        { ...options, modelIdMapping: { free: 's2.1-pro-free' } },
      ),
    ).rejects.toMatchObject({ error: { message: expect.stringContaining('params.speed') } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('rejects before calling Fish Audio', () => {
    it.each([
      ['an unknown model, which Fish would silently serve as S2.1 Pro', { model: 's3-ultra' }],
      ['an unsupported format', { params: { format: 'aac' as const } }],
      [
        'instructions on S1, which would speak them',
        { model: 's1', params: { instructions: 'x' } },
      ],
      ['empty input', { input: '   ' }],
      ['a voice id that is not a Fish model id', { voice: 'not_a_real_voice_xyz' }],
      [
        'a sample rate the format does not offer (opus is 48 kHz only)',
        { params: { format: 'opus' as const, sampleRate: 44_100 } },
      ],
      [
        'a sample rate mp3 does not offer',
        { params: { format: 'mp3' as const, sampleRate: 16_000 } },
      ],
    ])('%s', async (_, override) => {
      await expect(
        createFishAudioSpeech(
          { input: 'Hi', model: 's2.1-pro', voice: VOICE, ...override },
          options,
        ),
      ).rejects.toMatchObject({ errorType: AgentRuntimeErrorType.ProviderBizError });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it(`input over ${FISH_AUDIO_MAX_INPUT_CHARACTERS} characters`, async () => {
      await expect(
        createFishAudioSpeech(
          {
            input: 'a'.repeat(FISH_AUDIO_MAX_INPUT_CHARACTERS + 1),
            model: 's2.1-pro',
            voice: VOICE,
          },
          options,
        ),
      ).rejects.toMatchObject({
        error: { message: expect.stringContaining('the limit is 4096') },
        errorType: AgentRuntimeErrorType.ProviderBizError,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('maps upstream errors', () => {
    it.each([
      [401, AgentRuntimeErrorType.InvalidProviderAPIKey],
      [402, AgentRuntimeErrorType.InsufficientQuota],
      [403, AgentRuntimeErrorType.PermissionDenied],
      [429, AgentRuntimeErrorType.RateLimitExceeded],
      [500, AgentRuntimeErrorType.ProviderBizError],
    ])('HTTP %d → %s with the Fish message', async (status, errorType) => {
      fetchMock.mockResolvedValueOnce(errorResponse(status, { message: 'nope', status }));

      await expect(
        createFishAudioSpeech({ input: 'Hi', model: 's2.1-pro', voice: VOICE }, options),
      ).rejects.toMatchObject({
        error: { message: `Fish Audio API error (${status}): nope`, status },
        errorType,
        provider: 'fishaudio',
      });
    });

    it('explains a rejected voice', async () => {
      fetchMock.mockResolvedValueOnce(errorResponse(404, { message: 'Reference not found' }));

      await expect(
        createFishAudioSpeech({ input: 'Hi', model: 's2.1-pro', voice: VOICE }, options),
      ).rejects.toMatchObject({
        error: {
          message: `Fish Audio API error (404): Reference not found. ${FISH_AUDIO_VOICE_HINT}`,
        },
      });
    });

    it('reads plain-text bodies from the edge', async () => {
      fetchMock.mockResolvedValueOnce(errorResponse(503, 'upstream overloaded'));

      await expect(
        createFishAudioSpeech({ input: 'Hi', model: 's2.1-pro', voice: VOICE }, options),
      ).rejects.toMatchObject({
        error: { message: 'Fish Audio API error (503): upstream overloaded' },
        errorType: AgentRuntimeErrorType.ProviderBizError,
      });
    });

    it('fails on an empty 200 instead of returning silent audio', async () => {
      fetchMock.mockResolvedValueOnce(new Response(new Uint8Array(), { status: 200 }));

      await expect(
        createFishAudioSpeech({ input: 'Hi', model: 's2.1-pro', voice: VOICE }, options),
      ).rejects.toMatchObject({ error: { message: 'Fish Audio returned empty audio' } });
    });

    it('fails on a JSON 200 body', async () => {
      fetchMock.mockResolvedValueOnce(errorResponse(200, { message: 'queue full' }));

      await expect(
        createFishAudioSpeech({ input: 'Hi', model: 's2.1-pro', voice: VOICE }, options),
      ).rejects.toMatchObject({ error: { message: 'Fish Audio returned no audio: queue full' } });
    });

    it('rethrows aborts as is', async () => {
      const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
      fetchMock.mockRejectedValueOnce(abort);

      await expect(
        createFishAudioSpeech({ input: 'Hi', model: 's2.1-pro', voice: VOICE }, options),
      ).rejects.toBe(abort);
    });
  });
});

describe('Fish Audio request helpers', () => {
  it('normalizes the base URL', () => {
    expect(normalizeFishAudioBaseURL()).toBe('https://api.fish.audio');
    expect(normalizeFishAudioBaseURL('https://proxy.example.com/v1/')).toBe(
      'https://proxy.example.com',
    );
  });

  it('counts UTF-8 bytes', () => {
    expect(countFishAudioBilledBytes('abc')).toBe(3);
    expect(countFishAudioBilledBytes('语音')).toBe(6);
    expect(countFishAudioBilledBytes('😀')).toBe(4);
  });

  it('keeps brackets inside a direction from closing it early', () => {
    expect(buildFishAudioText('Hi', 's2.1-pro', ' [loud] then ')).toBe('[loud then] Hi');
    expect(buildFishAudioText('Hi', 's1', '  ')).toBe('Hi');
  });

  it('builds the body for the default voice without prosody', () => {
    expect(
      buildFishAudioSpeechRequest({ input: 'Hi', model: 's1', voice: 'default' }, 's1').body,
    ).toEqual({ format: 'mp3', text: 'Hi' });
  });
});
