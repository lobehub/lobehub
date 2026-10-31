// @vitest-environment node
import { AgentRuntimeErrorType } from '@lobechat/types';
import type { Pricing } from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { USD_TO_CNY } from '../../const/currency';
import { getModelPricing } from '../../utils/getModelPricing';
import {
  buildMiniMaxSpeechRequest,
  countMiniMaxSpeechCharacters,
  createMiniMaxSpeech,
  decodeMiniMaxHexAudio,
  getMiniMaxSpeechErrorType,
  LobeMinimaxSpeechAI,
  type MiniMaxSpeechOptions,
} from './createSpeech';
import { LobeMinimaxAI } from './index';

vi.mock('../../utils/getModelPricing', () => ({ getModelPricing: vi.fn() }));

const hdPricing: Pricing = {
  currency: 'CNY',
  units: [{ name: 'textInput', rate: 350, strategy: 'fixed', unit: 'millionCharacters' }],
};

const options: MiniMaxSpeechOptions = {
  apiKey: 'test-key',
  baseURL: 'https://api.minimaxi.com/v1',
  provider: 'minimax',
};

const okResponse = (overrides: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      base_resp: { status_code: 0, status_msg: 'success' },
      data: { audio: '49443303', status: 2 },
      extra_info: { audio_format: 'mp3', audio_length: 1200, usage_characters: 12 },
      trace_id: 'trace-1',
      ...overrides,
    }),
    { headers: { 'content-type': 'application/json' } },
  );

describe('createMiniMaxSpeech', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(getModelPricing).mockResolvedValue(hdPricing);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe('parameter mapping', () => {
    it('maps the standard params onto voice_setting and audio_setting', () => {
      const { body, format } = buildMiniMaxSpeechRequest(
        {
          input: '你好，世界',
          model: 'speech-2.8-hd',
          params: {
            emotion: 'happy',
            format: 'wav',
            pitch: -3,
            sampleRate: 24_000,
            speed: 1.2,
            volume: 2,
          },
          voice: 'female-shaonv',
        },
        'speech-2.8-hd',
      );

      expect(format).toBe('wav');
      expect(body).toEqual({
        audio_setting: { channel: 1, format: 'wav', sample_rate: 24_000 },
        model: 'speech-2.8-hd',
        output_format: 'hex',
        stream: false,
        text: '你好，世界',
        voice_setting: {
          emotion: 'happy',
          pitch: -3,
          speed: 1.2,
          vol: 2,
          voice_id: 'female-shaonv',
        },
      });
    });

    it('omits unset params so MiniMax applies its defaults, and reads the legacy speed', () => {
      const { body, format } = buildMiniMaxSpeechRequest(
        { input: 'hi', model: 'speech-2.8-turbo', speed: 0.8, voice: 'female-yujie' },
        'speech-2.8-turbo',
      );

      expect(format).toBe('mp3');
      expect(body.audio_setting).toEqual({ channel: 1, format: 'mp3' });
      expect(body.voice_setting).toEqual({ speed: 0.8, voice_id: 'female-yujie' });
    });

    it('rejects formats t2a_v2 cannot produce', async () => {
      await expect(
        createMiniMaxSpeech(
          { input: 'hi', model: 'speech-2.8-hd', params: { format: 'aac' }, voice: 'x' },
          options,
        ),
      ).rejects.toMatchObject({
        error: { message: 'MiniMax speech does not support the "aac" format' },
        errorType: AgentRuntimeErrorType.ProviderBizError,
        provider: 'minimax',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('posts to /t2a_v2 with the mapped model id, auth header and abort signal', async () => {
      fetchMock.mockResolvedValue(okResponse());
      const controller = new AbortController();

      await createMiniMaxSpeech(
        { input: '你好', model: 'speech-2.8-hd', voice: 'female-shaonv' },
        {
          ...options,
          headers: { 'X-Trace': '1' },
          modelIdMapping: { 'speech-2.8-hd': 'speech-2.8-hd-upstream' },
          signal: controller.signal,
        },
      );

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.minimaxi.com/v1/t2a_v2');
      expect(init.method).toBe('POST');
      expect(init.signal).toBe(controller.signal);
      expect(init.headers).toMatchObject({
        'Authorization': 'Bearer test-key',
        'Content-Type': 'application/json',
        'X-Trace': '1',
      });
      expect(JSON.parse(init.body).model).toBe('speech-2.8-hd-upstream');
    });
  });

  describe('hex decoding', () => {
    it('decodes the hex audio into bytes', () => {
      expect(new Uint8Array(decodeMiniMaxHexAudio('494433ff00'))).toEqual(
        new Uint8Array([0x49, 0x44, 0x33, 0xff, 0x00]),
      );
    });

    it.each([[undefined], [''], ['abc'], ['zz11']])('rejects invalid hex %j', (hex) => {
      expect(() => decodeMiniMaxHexAudio(hex)).toThrow('MiniMax returned no valid hex audio');
    });

    it('returns the decoded audio with the requested format', async () => {
      fetchMock.mockResolvedValue(okResponse());

      const result = await createMiniMaxSpeech(
        { input: '你好', model: 'speech-2.8-hd', voice: 'female-shaonv' },
        options,
      );

      expect(new Uint8Array(result.audio)).toEqual(new Uint8Array([0x49, 0x44, 0x33, 0x03]));
      expect(result.format).toBe('mp3');
    });

    it('fails a successful status without audio instead of returning empty bytes', async () => {
      fetchMock.mockResolvedValue(okResponse({ data: null }));
      const onUsage = vi.fn();

      await expect(
        createMiniMaxSpeech(
          { input: '你好', model: 'speech-2.8-hd', voice: 'female-shaonv' },
          { ...options, onUsage },
        ),
      ).rejects.toMatchObject({ errorType: AgentRuntimeErrorType.ProviderBizError });
      expect(onUsage).not.toHaveBeenCalled();
    });
  });

  describe('usage', () => {
    it('bills extra_info.usage_characters and prices it in CNY', async () => {
      fetchMock.mockResolvedValue(okResponse());
      const onUsage = vi.fn();

      const result = await createMiniMaxSpeech(
        { input: '你好', model: 'speech-2.8-hd', voice: 'female-shaonv' },
        { ...options, onUsage, pricingContext: { channelId: 'c1' } as any },
      );

      // The provider-billed count (12) wins over the local count (2).
      expect(result.usage?.inputCharacters).toBe(12);
      expect(result.usage?.cost).toBeGreaterThan(0);
      expect(onUsage).toHaveBeenCalledWith(result.usage);
      expect(getModelPricing).toHaveBeenCalledWith('speech-2.8-hd', 'minimax', {
        channelId: 'c1',
      });
    });

    it('prices 10k billed characters at ¥3.5 for HD', async () => {
      fetchMock.mockResolvedValue(okResponse({ extra_info: { usage_characters: 10_000 } }));

      const result = await createMiniMaxSpeech(
        { input: 'x', model: 'speech-2.8-hd', voice: 'female-shaonv' },
        options,
      );

      // Cost is reported in USD: ¥350 per 1M characters → ¥3.5 for 10k.
      expect(result.usage?.inputCharacters).toBe(10_000);
      expect(result.usage?.cost).toBeCloseTo(3.5 / USD_TO_CNY, 4);
    });

    it('falls back to MiniMax billing rules when usage_characters is missing', async () => {
      fetchMock.mockResolvedValue(okResponse({ extra_info: {} }));

      const result = await createMiniMaxSpeech(
        { input: '你好, hi😀', model: 'speech-2.8-hd', voice: 'female-shaonv' },
        options,
      );

      // 2 Chinese characters × 2 + ", hi😀" (5 code points) × 1
      expect(result.usage?.inputCharacters).toBe(9);
    });

    it('counts Chinese characters twice', () => {
      expect(countMiniMaxSpeechCharacters('你好')).toBe(4);
      expect(countMiniMaxSpeechCharacters('hello, world')).toBe(12);
      expect(countMiniMaxSpeechCharacters('')).toBe(0);
    });
  });

  describe('error mapping', () => {
    it.each([
      [1004, AgentRuntimeErrorType.InvalidProviderAPIKey],
      [2049, AgentRuntimeErrorType.InvalidProviderAPIKey],
      [1002, AgentRuntimeErrorType.RateLimitExceeded],
      // 1039 is a token limit the request must be adjusted for, not a retryable rate limit
      [1039, AgentRuntimeErrorType.ProviderBizError],
      [1045, AgentRuntimeErrorType.RateLimitExceeded],
      [2045, AgentRuntimeErrorType.RateLimitExceeded],
      [2062, AgentRuntimeErrorType.RateLimitExceeded],
      [1008, AgentRuntimeErrorType.InsufficientQuota],
      [2053, AgentRuntimeErrorType.InsufficientQuota],
      [2056, AgentRuntimeErrorType.InsufficientQuota],
      [2067, AgentRuntimeErrorType.InsufficientQuota],
      [2013, AgentRuntimeErrorType.ProviderBizError],
      [1000, AgentRuntimeErrorType.ProviderBizError],
    ])('maps status_code %d to %s', async (statusCode, errorType) => {
      expect(getMiniMaxSpeechErrorType(statusCode)).toBe(errorType);

      fetchMock.mockResolvedValue(
        okResponse({ base_resp: { status_code: statusCode, status_msg: 'boom' }, data: null }),
      );

      await expect(
        createMiniMaxSpeech(
          { input: '你好', model: 'speech-2.8-hd', voice: 'female-shaonv' },
          options,
        ),
      ).rejects.toEqual({
        error: {
          base_resp: { status_code: statusCode, status_msg: 'boom' },
          message: 'MiniMax API error: boom',
          trace_id: 'trace-1',
        },
        errorType,
        provider: 'minimax',
      });
    });

    it('maps HTTP failures by status', async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ base_resp: { status_code: 1004, status_msg: 'bad key' } }), {
          status: 401,
          statusText: 'Unauthorized',
        }),
      );

      await expect(
        createMiniMaxSpeech(
          { input: '你好', model: 'speech-2.8-hd', voice: 'female-shaonv' },
          options,
        ),
      ).rejects.toMatchObject({
        error: { message: 'MiniMax API error (401): bad key', status: 401 },
        errorType: AgentRuntimeErrorType.InvalidProviderAPIKey,
      });
    });

    it('wraps network failures as provider errors and passes aborts through', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
      await expect(
        createMiniMaxSpeech({ input: 'a', model: 'speech-2.8-hd', voice: 'v' }, options),
      ).rejects.toMatchObject({
        error: { message: 'fetch failed' },
        errorType: AgentRuntimeErrorType.ProviderBizError,
      });

      const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
      fetchMock.mockRejectedValueOnce(abort);
      await expect(
        createMiniMaxSpeech({ input: 'a', model: 'speech-2.8-hd', voice: 'v' }, options),
      ).rejects.toBe(abort);
    });
  });

  describe('LobeMinimaxAI routing', () => {
    it.each([
      ['default base URL', {}, 'https://api.minimaxi.com/v1/t2a_v2'],
      [
        'global Anthropic base URL',
        { baseURL: 'https://api.minimax.io/anthropic' },
        'https://api.minimax.io/v1/t2a_v2',
      ],
      [
        'Anthropic SDK type and /v1/messages URL',
        { baseURL: 'https://api.minimax.io/anthropic/v1/messages', sdkType: 'anthropic' },
        'https://api.minimax.io/v1/t2a_v2',
      ],
      [
        'China Anthropic base URL',
        { baseURL: 'https://api.minimaxi.com/anthropic' },
        'https://api.minimaxi.com/v1/t2a_v2',
      ],
    ])('sends speech models to t2a_v2 with the %s', async (_name, runtimeOptions, expectedURL) => {
      fetchMock.mockResolvedValue(okResponse());
      const runtime = new LobeMinimaxAI({ apiKey: 'test-key', ...runtimeOptions });

      const result = await runtime.textToSpeech!({
        input: '你好',
        model: 'speech-2.8-hd',
        params: { emotion: 'calm' },
        voice: 'female-shaonv',
      });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(expectedURL);
      expect(JSON.parse(init.body).voice_setting).toEqual({
        emotion: 'calm',
        voice_id: 'female-shaonv',
      });
      expect(result.usage?.inputCharacters).toBe(12);
    });

    it('routes an alias mapped onto a speech model to t2a_v2', async () => {
      fetchMock.mockResolvedValue(okResponse());
      const runtime = new LobeMinimaxAI({
        apiKey: 'test-key',
        baseURL: 'https://api.minimax.io/anthropic',
        modelIdMapping: { 'voice-prod': 'speech-2.8-hd' },
      } as any);

      await runtime.textToSpeech!({ input: 'hi', model: 'voice-prod', voice: 'female-yujie' });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.minimax.io/v1/t2a_v2');
      expect(JSON.parse(init.body).model).toBe('speech-2.8-hd');
    });

    it('requires an API key', () => {
      expect(
        () => new LobeMinimaxSpeechAI({ baseURL: 'https://api.minimaxi.com/v1', id: 'minimax' }),
      ).toThrow();
    });

    it('keeps a custom OpenAI-style base URL without doubling its trailing slash', async () => {
      fetchMock.mockResolvedValue(okResponse());
      const runtime = new LobeMinimaxAI({
        apiKey: 'test-key',
        baseURL: 'https://api.minimax.io/v1/',
      });

      await runtime.textToSpeech!({ input: 'hi', model: 'speech-02-turbo', voice: 'female-yujie' });

      expect(fetchMock.mock.calls[0][0]).toBe('https://api.minimax.io/v1/t2a_v2');
    });
  });
});
