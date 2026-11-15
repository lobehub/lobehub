// @vitest-environment node
import { AgentRuntimeErrorType } from '@lobechat/types';
import type { Pricing } from 'model-bank';
import { ELEVENLABS_DEFAULT_VOICE_ID } from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getModelPricing } from '../../utils/getModelPricing';
import {
  buildElevenLabsSpeechRequest,
  clearElevenLabsFallbackVoices,
  createElevenLabsSpeech,
  ELEVENLABS_MAX_INPUT_CHARACTERS,
  ELEVENLABS_NO_ACCOUNT_VOICE_HINT,
  ELEVENLABS_PAID_VOICE_HINT,
  type ElevenLabsSpeechOptions,
  FALLBACK_VOICE_TTL_MS,
  normalizeElevenLabsBaseURL,
  resolveElevenLabsOutputFormat,
} from './createSpeech';

vi.mock('../../utils/getModelPricing', () => ({ getModelPricing: vi.fn() }));

// $0.08 per 1k characters, as on the eleven_multilingual_v2 card
const multilingualPricing: Pricing = {
  units: [{ name: 'textInput', rate: 80, strategy: 'fixed', unit: 'millionCharacters' }],
};

const options: ElevenLabsSpeechOptions = {
  apiKey: 'xi-test-key',
  baseURL: 'https://api.elevenlabs.io',
  provider: 'elevenlabs',
};

const VOICE = 'OZ0L6eISlOejga3XjDFt';
const AUDIO_BYTES = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00]);

const audioResponse = (headers: Record<string, string> = {}) =>
  new Response(AUDIO_BYTES, {
    headers: { 'content-type': 'audio/mpeg', 'request-id': 'req-1', ...headers },
    status: 200,
  });

const errorResponse = (status: number, body: unknown, statusText = '') =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
    statusText,
  });

describe('createElevenLabsSpeech', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(getModelPricing).mockResolvedValue(multilingualPricing);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    clearElevenLabsFallbackVoices();
  });

  describe('request mapping', () => {
    it('sends text and model_id, and omits voice_settings when nothing is set', () => {
      const { body, format, outputFormat } = buildElevenLabsSpeechRequest(
        { input: 'Hello', model: 'eleven_multilingual_v2', voice: VOICE },
        'eleven_multilingual_v2',
      );

      expect(body).toEqual({ model_id: 'eleven_multilingual_v2', text: 'Hello' });
      expect(format).toBe('mp3');
      expect(outputFormat).toBe('mp3_44100_128');
    });

    it('maps speed (and the legacy top-level speed) onto voice_settings.speed', () => {
      expect(
        buildElevenLabsSpeechRequest(
          { input: 'Hi', model: 'm', params: { speed: 1.1 }, voice: VOICE },
          'm',
        ).body,
      ).toEqual({ model_id: 'm', text: 'Hi', voice_settings: { speed: 1.1 } });

      expect(
        buildElevenLabsSpeechRequest({ input: 'Hi', model: 'm', speed: 0.8, voice: VOICE }, 'm')
          .body,
      ).toMatchObject({ voice_settings: { speed: 0.8 } });
    });

    it.each([
      ['mp3', undefined, 'mp3_44100_128'],
      ['mp3', 22_050, 'mp3_22050_32'],
      ['opus', undefined, 'opus_48000_128'],
      ['pcm', undefined, 'pcm_24000'],
      ['pcm', 16_000, 'pcm_16000'],
      ['wav', undefined, 'wav_44100'],
      ['wav', 48_000, 'wav_48000'],
      ['wav', 12_345, 'wav_44100'],
    ] as const)('maps format %s / sampleRate %s to output_format %s', (format, rate, expected) => {
      expect(resolveElevenLabsOutputFormat(format, rate)).toBe(expected);
    });

    it.each(['aac', 'flac'] as const)('rejects the unsupported %s format', (format) => {
      expect(() => resolveElevenLabsOutputFormat(format)).toThrow(
        `ElevenLabs speech does not support the "${format}" format`,
      );
    });

    it('normalizes a base URL with many slashes in linear time', () => {
      const input = `https://proxy.example.com${'/'.repeat(100_000)}x`;
      const start = performance.now();
      expect(normalizeElevenLabsBaseURL(input)).toBe(input);
      expect(normalizeElevenLabsBaseURL(`https://h${'/'.repeat(100_000)}`)).toBe('https://h');
      expect(performance.now() - start).toBeLessThan(500);
    });

    it('normalizes the base URL, with or without /v1 and trailing slashes', () => {
      expect(normalizeElevenLabsBaseURL(undefined)).toBe('https://api.elevenlabs.io');
      expect(normalizeElevenLabsBaseURL('')).toBe('https://api.elevenlabs.io');
      expect(normalizeElevenLabsBaseURL('https://api.eu.residency.elevenlabs.io/')).toBe(
        'https://api.eu.residency.elevenlabs.io',
      );
      expect(normalizeElevenLabsBaseURL('https://proxy.example.com/v1/')).toBe(
        'https://proxy.example.com',
      );
    });
  });

  describe('success', () => {
    it('POSTs to /v1/text-to-speech/{voice_id} with xi-api-key and returns the audio bytes', async () => {
      fetchMock.mockResolvedValue(audioResponse({ 'character-cost': '4' }));
      const onUsage = vi.fn();

      const result = await createElevenLabsSpeech(
        {
          input: 'Hello world',
          model: 'eleven_multilingual_v2',
          params: { format: 'opus', speed: 1.05 },
          voice: VOICE,
        },
        { ...options, headers: { 'x-trace': 't1' }, onUsage },
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(
        `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=opus_48000_128`,
      );
      expect(init.method).toBe('POST');
      expect(init.headers).toMatchObject({
        'Content-Type': 'application/json',
        'x-trace': 't1',
        'xi-api-key': 'xi-test-key',
      });
      expect(init.headers.Authorization).toBeUndefined();
      expect(JSON.parse(init.body)).toEqual({
        model_id: 'eleven_multilingual_v2',
        text: 'Hello world',
        voice_settings: { speed: 1.05 },
      });

      expect(result.format).toBe('opus');
      expect(new Uint8Array(result.audio)).toEqual(AUDIO_BYTES);
      // 11 chars × $80 / 1M chars
      expect(result.usage).toEqual({ cost: 0.000_88, inputCharacters: 11 });
      expect(onUsage).toHaveBeenCalledWith(result.usage);
      expect(getModelPricing).toHaveBeenCalledWith(
        'eleven_multilingual_v2',
        'elevenlabs',
        undefined,
      );
    });

    it('bills input characters, not the character-cost credits header', async () => {
      // Real Flash responses report e.g. character-cost=7 for 34 characters.
      fetchMock.mockResolvedValue(audioResponse({ 'character-cost': '3' }));

      const result = await createElevenLabsSpeech(
        { input: 'Hello world', model: 'eleven_multilingual_v2', voice: VOICE },
        options,
      );

      expect(result.usage?.inputCharacters).toBe(11);
    });

    it('falls back to counting code points when the header is missing', async () => {
      fetchMock.mockResolvedValue(audioResponse());

      const result = await createElevenLabsSpeech(
        { input: '你好，世界', model: 'eleven_flash_v2_5', voice: VOICE },
        options,
      );

      expect(result.usage?.inputCharacters).toBe(5);
    });

    it('passes the voice id and model id through, applying model id mapping', async () => {
      fetchMock.mockResolvedValue(audioResponse());

      await createElevenLabsSpeech(
        { input: 'Hi', model: 'my-alias', voice: 'custom/voice id' },
        {
          ...options,
          baseURL: 'https://proxy.example.com/v1/',
          modelIdMapping: { 'my-alias': 'eleven_v4' },
        },
      );

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(
        'https://proxy.example.com/v1/text-to-speech/custom%2Fvoice%20id?output_format=mp3_44100_128',
      );
      expect(JSON.parse(init.body).model_id).toBe('eleven_v4');
      // pricing keys off the public model id
      expect(getModelPricing).toHaveBeenCalledWith('my-alias', 'elevenlabs', undefined);
    });

    it('forwards the abort signal', async () => {
      fetchMock.mockResolvedValue(audioResponse());
      const controller = new AbortController();

      await createElevenLabsSpeech(
        { input: 'Hi', model: 'eleven_v4', voice: VOICE },
        { ...options, signal: controller.signal },
      );

      expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
    });
  });

  describe('routed aliases', () => {
    it('replaces a non-ElevenLabs default voice filled in by the service', async () => {
      fetchMock.mockResolvedValueOnce(audioResponse());

      await createElevenLabsSpeech(
        { input: 'Hi', model: 'my-speech', voice: 'alloy', voiceIsDefault: true },
        {
          ...options,
          modelIdMapping: { 'my-speech': 'eleven_flash_v2_5' },
        } as ElevenLabsSpeechOptions,
      );

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain(`/v1/text-to-speech/${ELEVENLABS_DEFAULT_VOICE_ID}?`);
      expect(JSON.parse(init.body).model_id).toBe('eleven_flash_v2_5');
    });

    it('keeps an explicit voice even when it is not in the catalog', async () => {
      fetchMock.mockResolvedValueOnce(audioResponse());
      await createElevenLabsSpeech({ input: 'Hi', model: 'm', voice: 'my-clone' }, options);
      expect(fetchMock.mock.calls[0][0]).toContain('/v1/text-to-speech/my-clone?');
    });

    it('rejects input over the per-request cap before calling ElevenLabs', async () => {
      await expect(
        createElevenLabsSpeech(
          {
            input: '字'.repeat(ELEVENLABS_MAX_INPUT_CHARACTERS + 1),
            model: 'my-speech',
            voice: VOICE,
          },
          options,
        ),
      ).rejects.toMatchObject({ errorType: AgentRuntimeErrorType.ProviderBizError });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('default voice fallback', () => {
    const callDefault = () =>
      createElevenLabsSpeech(
        {
          input: 'Hello',
          model: 'eleven_flash_v2_5',
          voice: ELEVENLABS_DEFAULT_VOICE_ID,
          voiceIsDefault: true,
        },
        options,
      );
    const paymentRequired = () =>
      errorResponse(402, {
        detail: {
          message: 'Free users cannot use library voices via the API.',
          status: 'payment_required',
        },
      });
    const voicesResponse = (voices: unknown[]) =>
      new Response(JSON.stringify({ voices }), { headers: { 'content-type': 'application/json' } });

    it('retries once with an account voice, preferring created voices over premade ones', async () => {
      fetchMock
        .mockResolvedValueOnce(
          errorResponse(404, { detail: { message: 'Voice not found', status: 'voice_not_found' } }),
        )
        // personal: the rejected default is skipped, an owned clone is taken
        .mockResolvedValueOnce(
          voicesResponse([
            { category: 'generated', is_owner: true, voice_id: ELEVENLABS_DEFAULT_VOICE_ID },
            { category: 'professional', is_owner: true, voice_id: 'pvc-1' },
          ]),
        )
        .mockResolvedValueOnce(audioResponse());

      const result = await callDefault();

      expect(result.audio.byteLength).toBe(AUDIO_BYTES.byteLength);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls[1][0]).toBe(
        'https://api.elevenlabs.io/v2/voices?voice_type=personal&page_size=2',
      );
      expect(fetchMock.mock.calls[1][1].headers['xi-api-key']).toBe('xi-test-key');
      expect(fetchMock.mock.calls[2][0]).toContain('/v1/text-to-speech/pvc-1?');
    });

    it('skips Voice Library voices the account does not own, then uses premade ones', async () => {
      fetchMock
        .mockResolvedValueOnce(paymentRequired())
        .mockResolvedValueOnce(
          voicesResponse([{ category: 'professional', is_owner: false, voice_id: 'library-1' }]),
        )
        .mockResolvedValueOnce(voicesResponse([{ category: 'premade', voice_id: 'premade-1' }]))
        .mockResolvedValueOnce(audioResponse());

      await callDefault();

      expect(fetchMock.mock.calls[2][0]).toBe(
        'https://api.elevenlabs.io/v2/voices?category=premade&page_size=2',
      );
      expect(fetchMock.mock.calls[3][0]).toContain('/v1/text-to-speech/premade-1?');
    });

    it('explains how to pick a voice when the account voices cannot be listed', async () => {
      fetchMock.mockResolvedValueOnce(paymentRequired()).mockResolvedValueOnce(
        errorResponse(401, {
          detail: { message: 'missing voices_read', status: 'missing_permissions' },
        }),
      );

      await expect(callDefault()).rejects.toMatchObject({
        error: { message: expect.stringContaining(ELEVENLABS_NO_ACCOUNT_VOICE_HINT) },
        errorType: AgentRuntimeErrorType.InsufficientQuota,
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('surfaces the retry error when the account voice also fails', async () => {
      fetchMock
        .mockResolvedValueOnce(paymentRequired())
        .mockResolvedValueOnce(
          voicesResponse([{ category: 'cloned', is_owner: true, voice_id: 'clone-1' }]),
        )
        .mockResolvedValueOnce(
          errorResponse(429, { detail: { message: 'busy', status: 'system_busy' } }),
        );

      await expect(callDefault()).rejects.toMatchObject({
        error: { message: 'ElevenLabs API error (429): busy' },
        errorType: AgentRuntimeErrorType.RateLimitExceeded,
      });
    });

    const warmCache = async () => {
      fetchMock
        .mockResolvedValueOnce(paymentRequired())
        .mockResolvedValueOnce(
          voicesResponse([{ category: 'cloned', is_owner: true, voice_id: 'clone-1' }]),
        )
        .mockResolvedValueOnce(audioResponse());
      await callDefault();
      fetchMock.mockClear();
    };

    it('reuses the resolved voice for the same key without retrying the default', async () => {
      await warmCache();

      fetchMock.mockResolvedValueOnce(audioResponse());
      await callDefault();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toContain('/v1/text-to-speech/clone-1?');

      // A different key does not share the entry.
      fetchMock.mockClear();
      fetchMock.mockResolvedValueOnce(audioResponse());
      await createElevenLabsSpeech(
        {
          input: 'Hello',
          model: 'eleven_flash_v2_5',
          voice: ELEVENLABS_DEFAULT_VOICE_ID,
          voiceIsDefault: true,
        },
        { ...options, apiKey: 'other-key' },
      );
      expect(fetchMock.mock.calls[0][0]).toContain(
        `/v1/text-to-speech/${ELEVENLABS_DEFAULT_VOICE_ID}?`,
      );
    });

    it('drops a cached voice that stops working and starts over from the default', async () => {
      await warmCache();

      fetchMock
        .mockResolvedValueOnce(
          errorResponse(404, { detail: { message: 'Voice not found', status: 'voice_not_found' } }),
        )
        .mockResolvedValueOnce(audioResponse());
      await callDefault();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1][0]).toContain(
        `/v1/text-to-speech/${ELEVENLABS_DEFAULT_VOICE_ID}?`,
      );

      // The default worked, so nothing is cached any more.
      fetchMock.mockClear();
      fetchMock.mockResolvedValueOnce(audioResponse());
      await callDefault();
      expect(fetchMock.mock.calls[0][0]).toContain(
        `/v1/text-to-speech/${ELEVENLABS_DEFAULT_VOICE_ID}?`,
      );
    });

    it('keeps the cache entry on unrelated errors, and expires it after the TTL', async () => {
      await warmCache();

      fetchMock.mockResolvedValueOnce(
        errorResponse(429, { detail: { message: 'busy', status: 'system_busy' } }),
      );
      await expect(callDefault()).rejects.toMatchObject({
        errorType: AgentRuntimeErrorType.RateLimitExceeded,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Still cached within the TTL: the next request goes straight to the cached voice.
      fetchMock.mockClear();
      fetchMock.mockResolvedValueOnce(audioResponse());
      await callDefault();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toContain('/v1/text-to-speech/clone-1?');

      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now + FALLBACK_VOICE_TTL_MS + 1);
      fetchMock.mockClear();
      fetchMock.mockResolvedValueOnce(audioResponse());
      await callDefault();
      expect(fetchMock.mock.calls[0][0]).toContain(
        `/v1/text-to-speech/${ELEVENLABS_DEFAULT_VOICE_ID}?`,
      );
    });

    it('keeps an explicitly requested default voice instead of substituting one', async () => {
      fetchMock.mockResolvedValueOnce(paymentRequired());

      await expect(
        createElevenLabsSpeech(
          { input: 'Hello', model: 'eleven_flash_v2_5', voice: ELEVENLABS_DEFAULT_VOICE_ID },
          options,
        ),
      ).rejects.toMatchObject({ errorType: AgentRuntimeErrorType.InsufficientQuota });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Nothing was cached either: an omitted voice still starts from the default.
      fetchMock.mockClear();
      fetchMock.mockResolvedValueOnce(audioResponse());
      await callDefault();
      expect(fetchMock.mock.calls[0][0]).toContain(
        `/v1/text-to-speech/${ELEVENLABS_DEFAULT_VOICE_ID}?`,
      );
    });

    it('treats exhausted credits as a quota error, not an unavailable voice', async () => {
      fetchMock.mockResolvedValueOnce(
        errorResponse(402, {
          detail: {
            code: 'insufficient_credits',
            message: 'You have run out of credits.',
            status: 'payment_required',
          },
        }),
      );

      await expect(callDefault()).rejects.toMatchObject({
        error: { message: 'ElevenLabs API error (402): You have run out of credits.' },
        errorType: AgentRuntimeErrorType.InsufficientQuota,
      });
      // No voice lookup, no retry.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('falls back on a 402 that names the voice even without a known code', async () => {
      fetchMock
        .mockResolvedValueOnce(
          errorResponse(402, {
            detail: { message: 'Free users cannot use library voices via the API.' },
          }),
        )
        .mockResolvedValueOnce(voicesResponse([{ category: 'premade', voice_id: 'premade-1' }]))
        .mockResolvedValueOnce(audioResponse());

      await callDefault();
      expect(fetchMock.mock.calls[2][0]).toContain('/v1/text-to-speech/premade-1?');
    });

    it('does not fall back for an explicitly chosen voice or for other errors', async () => {
      fetchMock.mockResolvedValueOnce(paymentRequired());
      await expect(
        createElevenLabsSpeech(
          { input: 'Hello', model: 'eleven_flash_v2_5', voice: VOICE },
          options,
        ),
      ).rejects.toMatchObject({
        errorType: AgentRuntimeErrorType.InsufficientQuota,
      });

      fetchMock.mockResolvedValueOnce(
        errorResponse(401, { detail: { message: 'Invalid API key' } }),
      );
      await expect(callDefault()).rejects.toMatchObject({
        errorType: AgentRuntimeErrorType.InvalidProviderAPIKey,
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('errors', () => {
    const call = () =>
      createElevenLabsSpeech({ input: 'Hi', model: 'eleven_v4', voice: VOICE }, options);

    it('maps 401 invalid_api_key to InvalidProviderAPIKey with a readable message', async () => {
      fetchMock.mockResolvedValue(
        errorResponse(401, {
          detail: { message: 'Invalid API key', status: 'invalid_api_key' },
        }),
      );

      await expect(call()).rejects.toMatchObject({
        error: {
          detail: { message: 'Invalid API key', status: 'invalid_api_key' },
          message: 'ElevenLabs API error (401): Invalid API key',
          status: 401,
        },
        errorType: AgentRuntimeErrorType.InvalidProviderAPIKey,
        provider: 'elevenlabs',
      });
    });

    it('maps a 401 quota_exceeded to InsufficientQuota rather than a bad key', async () => {
      fetchMock.mockResolvedValue(
        errorResponse(401, {
          detail: {
            message: 'This request exceeds your quota of 10000.',
            status: 'quota_exceeded',
          },
        }),
      );

      await expect(call()).rejects.toMatchObject({
        error: { message: 'ElevenLabs API error (401): This request exceeds your quota of 10000.' },
        errorType: AgentRuntimeErrorType.InsufficientQuota,
      });
    });

    it('maps 422 validation errors to ProviderBizError and keeps the field messages', async () => {
      fetchMock.mockResolvedValue(
        errorResponse(422, {
          detail: [{ loc: ['body', 'text'], msg: 'Field required', type: 'missing' }],
        }),
      );

      await expect(call()).rejects.toMatchObject({
        error: { message: 'ElevenLabs API error (422): body.text: Field required', status: 422 },
        errorType: AgentRuntimeErrorType.ProviderBizError,
      });
    });

    it('maps 429 to RateLimitExceeded', async () => {
      fetchMock.mockResolvedValue(
        errorResponse(429, {
          detail: {
            message: 'Too many concurrent requests',
            status: 'too_many_concurrent_requests',
          },
        }),
      );

      await expect(call()).rejects.toMatchObject({
        error: { message: 'ElevenLabs API error (429): Too many concurrent requests' },
        errorType: AgentRuntimeErrorType.RateLimitExceeded,
      });
    });

    it('maps 403 to PermissionDenied and 402 to InsufficientQuota', async () => {
      fetchMock.mockResolvedValueOnce(errorResponse(403, { detail: { message: 'Forbidden' } }));
      await expect(call()).rejects.toMatchObject({
        errorType: AgentRuntimeErrorType.PermissionDenied,
      });

      fetchMock.mockResolvedValueOnce(errorResponse(402, { detail: { message: 'Pay up' } }));
      await expect(call()).rejects.toMatchObject({
        errorType: AgentRuntimeErrorType.InsufficientQuota,
      });
    });

    it('adds the paid voice hint when ElevenLabs requires a paid plan', async () => {
      fetchMock.mockResolvedValueOnce(
        errorResponse(402, {
          detail: {
            message: 'Free users cannot use library voices via the API.',
            status: 'payment_required',
          },
        }),
      );

      await expect(call()).rejects.toMatchObject({
        error: {
          message: `ElevenLabs API error (402): Free users cannot use library voices via the API. ${ELEVENLABS_PAID_VOICE_HINT}`,
        },
        errorType: AgentRuntimeErrorType.InsufficientQuota,
      });
    });

    it('keeps a non-JSON error body and falls back to statusText', async () => {
      fetchMock.mockResolvedValueOnce(errorResponse(500, 'upstream exploded'));
      await expect(call()).rejects.toMatchObject({
        error: { message: 'ElevenLabs API error (500): upstream exploded' },
        errorType: AgentRuntimeErrorType.ProviderBizError,
      });

      fetchMock.mockResolvedValueOnce(errorResponse(503, '', 'Service Unavailable'));
      await expect(call()).rejects.toMatchObject({
        error: { message: 'ElevenLabs API error (503): Service Unavailable' },
      });
    });

    it('rejects an empty audio body instead of returning silence', async () => {
      fetchMock.mockResolvedValue(new Response(new Uint8Array(), { status: 200 }));
      const onUsage = vi.fn();

      await expect(
        createElevenLabsSpeech(
          { input: 'Hi', model: 'eleven_v4', voice: VOICE },
          { ...options, onUsage },
        ),
      ).rejects.toMatchObject({
        error: { message: 'ElevenLabs returned empty audio' },
        errorType: AgentRuntimeErrorType.ProviderBizError,
      });
      expect(onUsage).not.toHaveBeenCalled();
    });

    it('rejects unsupported formats and a missing voice before calling the API', async () => {
      await expect(
        createElevenLabsSpeech(
          { input: 'Hi', model: 'eleven_v4', params: { format: 'aac' }, voice: VOICE },
          options,
        ),
      ).rejects.toMatchObject({
        error: { message: 'ElevenLabs speech does not support the "aac" format' },
        errorType: AgentRuntimeErrorType.ProviderBizError,
      });

      await expect(
        createElevenLabsSpeech({ input: 'Hi', model: 'eleven_v4', voice: ' ' }, options),
      ).rejects.toMatchObject({ error: { message: 'ElevenLabs speech requires a voice id' } });

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('wraps network failures as ProviderBizError', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));

      await expect(call()).rejects.toMatchObject({
        error: { message: 'fetch failed' },
        errorType: AgentRuntimeErrorType.ProviderBizError,
        provider: 'elevenlabs',
      });
    });

    it('rethrows AbortError untouched', async () => {
      const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
      fetchMock.mockRejectedValue(abort);

      await expect(call()).rejects.toBe(abort);
    });
  });
});
