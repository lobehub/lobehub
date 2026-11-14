// @vitest-environment node
import type { GenerateContentResponse, GoogleGenAI } from '@google/genai';
import { ApiError } from '@google/genai';
import { AgentRuntimeErrorType } from '@lobechat/types';
import type { Pricing } from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getModelPricing } from '../../utils/getModelPricing';
import {
  buildGeminiSpeechRequest,
  convertGeminiSpeechTokenUsage,
  createGeminiSpeech,
  extractGeminiSpeechAudio,
  getGeminiSpeechErrorType,
  isPromptStyledGeminiTTSModel,
} from './createSpeech';
import { LobeGoogleAI } from './index';
import { encodeWav } from './speechAudio';

vi.mock('../../utils/getModelPricing', () => ({ getModelPricing: vi.fn() }));

const flashPricing: Pricing = {
  units: [
    { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
    { name: 'audioOutput', rate: 9, strategy: 'fixed', unit: 'millionTokens' },
  ],
};

/** One second of 24 kHz mono 16-bit PCM (a quiet ramp). */
const pcmSecond = () => {
  const data = Buffer.alloc(48_000);
  for (let i = 0; i < 24_000; i++) data.writeInt16LE((i % 200) * 20 - 2000, i * 2);
  return data;
};

const audioResponse = (
  data: Buffer,
  mimeType = 'audio/L16;codec=pcm;rate=24000',
  overrides: Partial<GenerateContentResponse> = {},
) =>
  ({
    candidates: [
      {
        content: { parts: [{ inlineData: { data: data.toString('base64'), mimeType } }] },
        finishReason: 'STOP',
      },
    ],
    usageMetadata: {
      candidatesTokenCount: 25,
      candidatesTokensDetails: [{ modality: 'AUDIO', tokenCount: 25 }],
      promptTokenCount: 8,
      promptTokensDetails: [{ modality: 'TEXT', tokenCount: 8 }],
      totalTokenCount: 33,
    },
    ...overrides,
  }) as unknown as GenerateContentResponse;

const createClient = (generateContent: ReturnType<typeof vi.fn>) =>
  ({ models: { generateContent } }) as unknown as GoogleGenAI;

const payload = { input: 'Hello there', model: 'gemini-3.8-flash-tts', voice: 'Kore' };

describe('buildGeminiSpeechRequest', () => {
  it('requests AUDIO with the prebuilt voice and the text as the only part', () => {
    const { format, request } = buildGeminiSpeechRequest(payload, 'gemini-3.8-flash-tts');

    expect(format).toBe('mp3');
    expect(request).toEqual({
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
      },
      contents: [{ parts: [{ text: 'Hello there' }], role: 'user' }],
      model: 'gemini-3.8-flash-tts',
    });
  });

  it('sends style instructions as speechMetadata on current models', () => {
    const { request } = buildGeminiSpeechRequest(
      { ...payload, params: { instructions: '  speak slowly and warmly ' } },
      'gemini-3.8-flash-tts',
    );

    expect(request.contents).toEqual([
      {
        parts: [{ speechMetadata: { style: 'speak slowly and warmly' }, text: 'Hello there' }],
        role: 'user',
      },
    ]);
  });

  it('prefixes style instructions into the prompt on Gemini 2.5 / 3.1 preview TTS', () => {
    for (const model of ['gemini-2.5-flash-preview-tts', 'gemini-3.1-flash-tts-preview']) {
      const { request } = buildGeminiSpeechRequest(
        { ...payload, model, params: { instructions: 'Say cheerfully' } },
        model,
      );
      expect(request.contents).toEqual([
        { parts: [{ text: 'Say cheerfully: Hello there' }], role: 'user' },
      ]);
    }
  });

  it('classifies legacy TTS ids, including gateway-prefixed ones, without backtracking', () => {
    expect(isPromptStyledGeminiTTSModel('gemini-2.5-pro-preview-tts')).toBe(true);
    expect(isPromptStyledGeminiTTSModel('google/gemini-3.1-flash-tts-preview')).toBe(true);
    expect(isPromptStyledGeminiTTSModel('gemini-3.8-flash-tts')).toBe(false);
    expect(isPromptStyledGeminiTTSModel('gemini-2.5-flash')).toBe(false);

    // CodeQL js/polynomial-redos: a backtracking pattern stalls on many prefix repetitions
    // until the test times out; the string checks return immediately.
    expect(isPromptStyledGeminiTTSModel('gemini-2.5-'.repeat(50_000))).toBe(false);
  });

  it('passes the abort signal and per-request headers to the SDK', () => {
    const signal = new AbortController().signal;
    const { request } = buildGeminiSpeechRequest(payload, 'gemini-3.8-flash-tts', {
      headers: { 'x-trace': '1' },
      signal,
    });

    expect(request.config).toMatchObject({
      abortSignal: signal,
      httpOptions: { headers: { 'x-trace': '1' } },
    });
  });

  it('rejects formats it cannot produce from PCM', () => {
    expect(() =>
      buildGeminiSpeechRequest({ ...payload, params: { format: 'opus' } }, payload.model),
    ).toThrow(/does not support the "opus" format/);
  });
});

describe('extractGeminiSpeechAudio', () => {
  it('parses the sample rate from the mime type and joins every audio part', () => {
    const first = pcmSecond();
    const response = audioResponse(first, 'audio/L16;codec=pcm;rate=16000');
    response.candidates![0].content!.parts!.push({
      inlineData: { data: first.toString('base64'), mimeType: 'audio/L16;codec=pcm;rate=16000' },
    });

    const pcm = extractGeminiSpeechAudio(response);
    expect(pcm.sampleRate).toBe(16_000);
    expect(pcm.data.length).toBe(first.length * 2);
  });

  it('maps a blocked prompt and a SAFETY finish to ContentModeration', () => {
    expect(() =>
      extractGeminiSpeechAudio({
        promptFeedback: { blockReason: 'PROHIBITED_CONTENT' },
      } as unknown as GenerateContentResponse),
    ).toThrow(expect.objectContaining({ errorType: AgentRuntimeErrorType.ContentModeration }));

    expect(() =>
      extractGeminiSpeechAudio({
        candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }],
      } as unknown as GenerateContentResponse),
    ).toThrow(expect.objectContaining({ errorType: AgentRuntimeErrorType.ContentModeration }));
  });

  it('treats a text-only answer as a provider error, not a billable synthesis', () => {
    expect(() =>
      extractGeminiSpeechAudio({
        candidates: [{ content: { parts: [{ text: 'I cannot' }] }, finishReason: 'STOP' }],
      } as unknown as GenerateContentResponse),
    ).toThrow(
      expect.objectContaining({
        errorType: AgentRuntimeErrorType.ProviderBizError,
        message: 'Gemini returned no audio (finishReason: STOP)',
      }),
    );
  });
});

describe('getGeminiSpeechErrorType', () => {
  it.each([
    [
      400,
      { details: [{ reason: 'API_KEY_INVALID' }], status: 'INVALID_ARGUMENT' },
      'InvalidProviderAPIKey',
    ],
    [400, { message: 'API key not valid. Please pass a valid API key.' }, 'InvalidProviderAPIKey'],
    [401, { status: 'UNAUTHENTICATED' }, 'InvalidProviderAPIKey'],
    [403, { status: 'PERMISSION_DENIED' }, 'PermissionDenied'],
    [404, { status: 'NOT_FOUND' }, 'ModelNotFound'],
    [429, { status: 'RESOURCE_EXHAUSTED' }, 'RateLimitExceeded'],
    [
      400,
      { status: 'INVALID_ARGUMENT', message: 'Voice name xyz is not supported' },
      'ProviderBizError',
    ],
    [
      400,
      { message: 'User location is not supported for the API use.', status: 'FAILED_PRECONDITION' },
      'LocationNotSupportError',
    ],
    [503, { status: 'UNAVAILABLE' }, 'ProviderServiceUnavailable'],
    [undefined, { status: 'RESOURCE_EXHAUSTED' }, 'RateLimitExceeded'],
    [undefined, { status: 'PERMISSION_DENIED' }, 'PermissionDenied'],
    [418, undefined, 'ProviderBizError'],
  ] as const)('HTTP %s %j -> %s', (status, body, expected) => {
    expect(getGeminiSpeechErrorType(status, body as any)).toBe(expected);
  });
});

describe('convertGeminiSpeechTokenUsage', () => {
  it('bills prompt tokens as text input and AUDIO candidate tokens as audio output', () => {
    expect(
      convertGeminiSpeechTokenUsage({
        candidatesTokenCount: 30,
        candidatesTokensDetails: [{ modality: 'AUDIO' as any, tokenCount: 28 }],
        promptTokenCount: 10,
        totalTokenCount: 40,
      }),
    ).toEqual({
      inputTextTokens: 10,
      outputAudioTokens: 28,
      totalInputTokens: 10,
      totalOutputTokens: 28,
      totalTokens: 40,
    });
  });

  it('falls back to candidatesTokenCount and returns undefined without counts', () => {
    expect(
      convertGeminiSpeechTokenUsage({ candidatesTokenCount: 5, promptTokenCount: 2 }),
    ).toMatchObject({ outputAudioTokens: 5, totalTokens: 7 });
    expect(convertGeminiSpeechTokenUsage({ promptTokenCount: 2 })).toBeUndefined();
    expect(convertGeminiSpeechTokenUsage(undefined)).toBeUndefined();
  });
});

describe('createGeminiSpeech', () => {
  beforeEach(() => {
    vi.mocked(getModelPricing).mockResolvedValue(flashPricing);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns playable MP3 by default and reports token usage with cost', async () => {
    const generateContent = vi.fn().mockResolvedValue(audioResponse(pcmSecond()));
    const onUsage = vi.fn();

    const result = await createGeminiSpeech(createClient(generateContent), payload, {
      onUsage,
      provider: 'google',
    });

    const audio = Buffer.from(result.audio);
    expect(result.format).toBe('mp3');
    expect(audio[0] === 0xff || audio.toString('ascii', 0, 3) === 'ID3').toBe(true);
    expect(audio.length).toBeLessThan(48_000 / 4);

    // 8 * $0.5/M + 25 * $9/M
    const expectedCost = (8 * 0.5 + 25 * 9) / 1_000_000;
    expect(result.usage).toMatchObject({
      inputCharacters: 11,
      inputTextTokens: 8,
      outputAudioTokens: 25,
      totalTokens: 33,
    });
    expect(result.usage?.cost).toBeCloseTo(expectedCost, 10);
    expect(onUsage).toHaveBeenCalledWith(result.usage);
    expect(getModelPricing).toHaveBeenCalledWith('gemini-3.8-flash-tts', 'google', undefined);
  });

  it('wraps PCM in a WAV header with the parsed sample rate', async () => {
    const pcm = pcmSecond();
    const generateContent = vi
      .fn()
      .mockResolvedValue(audioResponse(pcm, 'audio/L16;codec=pcm;rate=16000'));

    const result = await createGeminiSpeech(
      createClient(generateContent),
      { ...payload, params: { format: 'wav' } },
      { provider: 'google' },
    );

    const wav = Buffer.from(result.audio);
    expect(result.format).toBe('wav');
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(24)).toBe(16_000);
    expect(wav.subarray(44).equals(pcm)).toBe(true);
  });

  it('returns the raw PCM for format pcm, also when Gemini answers with WAV', async () => {
    const pcm = pcmSecond();
    const wav = encodeWav({ bitsPerSample: 16, channels: 1, data: pcm, sampleRate: 24_000 });
    const generateContent = vi.fn().mockResolvedValue(audioResponse(wav, 'audio/wav'));

    const result = await createGeminiSpeech(
      createClient(generateContent),
      { ...payload, params: { format: 'pcm' } },
      { provider: 'google' },
    );

    expect(result.format).toBe('pcm');
    expect(Buffer.from(result.audio).equals(pcm)).toBe(true);
  });

  it('sends the mapped upstream model id but prices the catalog id', async () => {
    const generateContent = vi.fn().mockResolvedValue(audioResponse(pcmSecond()));

    await createGeminiSpeech(createClient(generateContent), payload, {
      modelIdMapping: { 'gemini-3.8-flash-tts': 'gemini-3.8-flash-tts-001' },
      provider: 'google',
    });

    expect(generateContent.mock.calls[0][0].model).toBe('gemini-3.8-flash-tts-001');
    expect(getModelPricing).toHaveBeenCalledWith('gemini-3.8-flash-tts', 'google', undefined);
  });

  it('turns an SDK ApiError into a readable runtime error payload', async () => {
    const generateContent = vi.fn().mockRejectedValue(
      new ApiError({
        message: JSON.stringify({
          error: {
            code: 400,
            details: [
              { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', 'reason': 'API_KEY_INVALID' },
            ],
            message: 'API key not valid. Please pass a valid API key.',
            status: 'INVALID_ARGUMENT',
          },
        }),
        status: 400,
      }),
    );
    const onUsage = vi.fn();

    await expect(
      createGeminiSpeech(createClient(generateContent), payload, { onUsage, provider: 'google' }),
    ).rejects.toEqual({
      error: {
        code: 400,
        httpStatus: 400,
        message:
          'Gemini API error (INVALID_ARGUMENT): API key not valid. Please pass a valid API key.',
        status: 'INVALID_ARGUMENT',
      },
      errorType: AgentRuntimeErrorType.InvalidProviderAPIKey,
      provider: 'google',
    });
    expect(onUsage).not.toHaveBeenCalled();
  });

  it('maps a quota error and keeps the upstream message', async () => {
    const generateContent = vi.fn().mockRejectedValue(
      new ApiError({
        message: JSON.stringify({
          error: {
            code: 429,
            message: 'You exceeded your current quota.',
            status: 'RESOURCE_EXHAUSTED',
          },
        }),
        status: 429,
      }),
    );

    await expect(
      createGeminiSpeech(createClient(generateContent), payload, { provider: 'google' }),
    ).rejects.toMatchObject({
      error: { message: 'Gemini API error (RESOURCE_EXHAUSTED): You exceeded your current quota.' },
      errorType: AgentRuntimeErrorType.RateLimitExceeded,
    });
  });

  it('maps an over-long input to ExceededContextWindow through the shared Google parser', async () => {
    const generateContent = vi.fn().mockRejectedValue(
      new ApiError({
        message: JSON.stringify({
          error: {
            code: 400,
            message:
              'The input token count (9000) exceeds the maximum number of tokens allowed (8192).',
            status: 'INVALID_ARGUMENT',
          },
        }),
        status: 400,
      }),
    );

    await expect(
      createGeminiSpeech(createClient(generateContent), payload, { provider: 'google' }),
    ).rejects.toMatchObject({ errorType: AgentRuntimeErrorType.ExceededContextWindow });
  });

  it('rejects an empty audio payload without billing', async () => {
    const wav = encodeWav({
      bitsPerSample: 16,
      channels: 1,
      data: Buffer.alloc(0),
      sampleRate: 24_000,
    });
    const generateContent = vi.fn().mockResolvedValue(audioResponse(wav, 'audio/wav'));
    const onUsage = vi.fn();

    await expect(
      createGeminiSpeech(createClient(generateContent), payload, { onUsage, provider: 'google' }),
    ).rejects.toMatchObject({
      error: { message: 'Gemini returned empty audio' },
      errorType: AgentRuntimeErrorType.ProviderBizError,
    });
    expect(onUsage).not.toHaveBeenCalled();
  });

  it('reports a safety block without billing', async () => {
    const generateContent = vi.fn().mockResolvedValue({
      candidates: [{ content: { parts: [] }, finishReason: 'PROHIBITED_CONTENT' }],
      usageMetadata: { promptTokenCount: 8, totalTokenCount: 8 },
    });
    const onUsage = vi.fn();

    await expect(
      createGeminiSpeech(createClient(generateContent), payload, { onUsage, provider: 'google' }),
    ).rejects.toMatchObject({
      error: { finishReason: 'PROHIBITED_CONTENT' },
      errorType: AgentRuntimeErrorType.ContentModeration,
    });
    expect(onUsage).not.toHaveBeenCalled();
  });

  it('rethrows aborts untouched', async () => {
    const controller = new AbortController();
    controller.abort();
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const generateContent = vi.fn().mockRejectedValue(abortError);

    await expect(
      createGeminiSpeech(createClient(generateContent), payload, {
        provider: 'google',
        signal: controller.signal,
      }),
    ).rejects.toBe(abortError);
  });
});

describe('LobeGoogleAI.textToSpeech', () => {
  beforeEach(() => {
    vi.mocked(getModelPricing).mockResolvedValue(flashPricing);
  });

  it('synthesizes through the provider client under the runtime provider id', async () => {
    const generateContent = vi.fn().mockResolvedValue(audioResponse(pcmSecond()));
    const runtime = new LobeGoogleAI({
      apiKey: 'test-key',
      client: createClient(generateContent),
      id: 'google',
    });

    const result = await runtime.textToSpeech(payload);

    expect(result.format).toBe('mp3');
    expect(generateContent).toHaveBeenCalledOnce();
    expect(getModelPricing).toHaveBeenCalledWith('gemini-3.8-flash-tts', 'google', undefined);
  });

  it('sends generateContent to the custom base URL with the provider API key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(audioResponse(pcmSecond())), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      const runtime = new LobeGoogleAI({
        apiKey: 'test-key',
        baseURL: 'https://proxy.example.com',
      });
      const result = await runtime.textToSpeech(payload);

      expect(result.format).toBe('mp3');
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toBe(
        'https://proxy.example.com/v1beta/models/gemini-3.8-flash-tts:generateContent',
      );
      expect(new Headers(init.headers).get('x-goog-api-key')).toBe('test-key');
      expect(JSON.parse(init.body)).toMatchObject({
        contents: [{ parts: [{ text: 'Hello there' }], role: 'user' }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
        },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
