// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

import { ttsRouter } from '../tts';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return {};
  }),
}));

const textToSpeechMock = vi.fn();
vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(async () => ({ textToSpeech: textToSpeechMock })),
}));

const findByIdAndProviderMock = vi.fn();
vi.mock('@/database/models/aiModel', () => ({
  AiModelModel: vi.fn(function () {
    return { findByIdAndProvider: findByIdAndProviderMock };
  }),
}));

const caller = ttsRouter.createCaller({ jwtPayload: { userId: 'u1' }, userId: 'u1' } as any);

const usage = { cost: 0.000_075, inputCharacters: 5 };

beforeEach(() => {
  textToSpeechMock.mockResolvedValue({
    audio: new Uint8Array([1, 2, 3]).buffer,
    format: 'opus',
    usage,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ttsRouter.synthesize', () => {
  it('passes provider/model/voice/params to the runtime and returns audio, format and usage', async () => {
    const res = await caller.synthesize({
      input: 'hello',
      model: 'tts-1',
      params: { format: 'opus', speed: 1.5 },
      provider: 'openai',
      voice: 'nova',
    });

    expect(initModelRuntimeFromDB).toHaveBeenCalledWith(
      expect.anything(),
      'u1',
      'openai',
      undefined,
    );
    expect(textToSpeechMock).toHaveBeenCalledWith(
      {
        input: 'hello',
        model: 'tts-1',
        params: { format: 'opus', speed: 1.5 },
        voice: 'nova',
        voiceIsDefault: false,
      },
      { metadata: { trigger: 'tts' }, user: 'u1' },
    );
    expect(res).toEqual({
      audioBase64: Buffer.from([1, 2, 3]).toString('base64'),
      format: 'opus',
      mimeType: 'audio/opus',
      usage,
    });
  });

  it("defaults the voice to the model card's default voice", async () => {
    await caller.synthesize({ input: 'hello', model: 'gpt-4o-mini-tts', provider: 'openai' });

    expect(textToSpeechMock.mock.calls[0][0]).toMatchObject({ voice: 'alloy' });
  });

  it('maps the legacy top-level speed into params', async () => {
    await caller.synthesize({ input: 'hello', model: 'tts-1', speed: 2, voice: 'alloy' });

    expect(textToSpeechMock.mock.calls[0][0].params).toEqual({ speed: 2 });
  });

  it('drops the legacy speed for models that declare no speed instead of rejecting', async () => {
    await caller.synthesize({ input: 'hello', model: 'gpt-4o-mini-tts', speed: 1, voice: 'marin' });

    expect(textToSpeechMock.mock.calls[0][0].params).toEqual({});
  });

  it('rejects params the model card does not declare', async () => {
    await expect(
      caller.synthesize({
        input: 'hello',
        model: 'tts-1',
        params: { emotion: 'happy', speed: 9 },
        provider: 'openai',
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message:
        'params.emotion not supported by this model; params.speed must be between 0.25 and 4',
    });
    expect(textToSpeechMock).not.toHaveBeenCalled();
  });

  it('passes params through unchecked for models without a built-in card', async () => {
    await caller.synthesize({
      input: 'hello',
      model: 'custom-tts',
      params: { emotion: 'happy', pitch: 3 },
      provider: 'my-gateway',
      voice: 'v1',
    });

    expect(textToSpeechMock.mock.calls[0][0].params).toEqual({ emotion: 'happy', pitch: 3 });
  });

  it.each(['wav', 'pcm', 'flac'])(
    'rejects uncompressed %s before synthesizing, since inline audio would outgrow the response',
    async (format) => {
      await expect(
        caller.synthesize({ input: 'hello', model: 'tts-1', params: { format } as any }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: expect.stringContaining('params.format must be one of mp3, opus, aac'),
      });
      expect(textToSpeechMock).not.toHaveBeenCalled();
    },
  );

  it('rejects unknown param keys at the input boundary', async () => {
    await expect(
      caller.synthesize({
        input: 'hello',
        model: 'tts-1',
        params: { tone: 'warm' } as any,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('throws NOT_IMPLEMENTED when the provider has no text-to-speech', async () => {
    textToSpeechMock.mockResolvedValue(undefined);

    await expect(
      caller.synthesize({ input: 'hello', model: 'tts-1', voice: 'alloy' }),
    ).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
  });

  it('surfaces a readable message when the runtime rejects with an error payload', async () => {
    // Runtimes reject with plain `{ errorType, error }` objects, which tRPC used to flatten
    // into an INTERNAL_SERVER_ERROR without any message.
    textToSpeechMock.mockRejectedValue({
      error: { base_resp: { status_code: 2054, status_msg: 'voice id not exist' } },
      errorType: 'ProviderBizError',
    });

    await expect(
      caller.synthesize({
        input: 'hello',
        model: 'speech-2.8-hd',
        provider: 'minimax',
        voice: 'x',
      }),
    ).rejects.toMatchObject({ code: 'BAD_GATEWAY', message: 'voice id not exist' });
  });

  it('maps provider rate limits to TOO_MANY_REQUESTS', async () => {
    textToSpeechMock.mockRejectedValue(
      Object.assign(new Error('MiniMax API error: rate limit'), { errorType: 'RateLimitExceeded' }),
    );

    await expect(
      caller.synthesize({
        input: 'hello',
        model: 'speech-2.8-hd',
        provider: 'minimax',
        voice: 'x',
      }),
    ).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      message: 'MiniMax API error: rate limit',
    });
  });
  describe('provider elevenlabs', () => {
    it('routes provider elevenlabs to its runtime with the card default voice', async () => {
      textToSpeechMock.mockResolvedValue({
        audio: new Uint8Array([4, 5]).buffer,
        format: 'mp3',
        usage: { cost: 0.000_16, inputCharacters: 2 },
      });

      const res = await caller.synthesize({
        input: 'Hi',
        model: 'eleven_multilingual_v2',
        params: { speed: 1.1 },
        provider: 'elevenlabs',
      });

      expect(initModelRuntimeFromDB).toHaveBeenCalledWith(
        expect.anything(),
        'u1',
        'elevenlabs',
        undefined,
      );
      expect(textToSpeechMock).toHaveBeenCalledWith(
        {
          input: 'Hi',
          model: 'eleven_multilingual_v2',
          params: { speed: 1.1 },
          voice: 'CwhRBWXzGAHq8TQ4Fs17',
          voiceIsDefault: true,
        },
        { metadata: { trigger: 'tts' }, user: 'u1' },
      );
      expect(res).toEqual({
        audioBase64: Buffer.from([4, 5]).toString('base64'),
        format: 'mp3',
        mimeType: 'audio/mpeg',
        usage: { cost: 0.000_16, inputCharacters: 2 },
      });
    });

    it('validates params against the ElevenLabs card', async () => {
      await expect(
        caller.synthesize({
          input: 'Hi',
          model: 'eleven_multilingual_v2',
          params: { format: 'aac', speed: 2 },
          provider: 'elevenlabs',
        }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: expect.stringContaining('params.speed must be between 0.7 and 1.2'),
      });
      expect(textToSpeechMock).not.toHaveBeenCalled();
    });

    it('reports a missing API key with the InvalidProviderAPIKey copy instead of a bare 500', async () => {
      // what a runtime constructor throws when neither the user nor the server has a key
      vi.mocked(initModelRuntimeFromDB).mockRejectedValueOnce({
        errorType: 'InvalidProviderAPIKey',
      });

      const error = await caller
        .synthesize({ input: 'Hi', model: 'eleven_v4', provider: 'elevenlabs' })
        .catch((e) => e);

      expect(error).toMatchObject({
        code: 'BAD_GATEWAY',
        message:
          'ElevenLabs API Key is incorrect or empty, please check your ElevenLabs API Key and try again. Set it in Settings → AI Providers → ElevenLabs, or in the server environment.',
      });
      // the lambda errorFormatter exposes `cause.data` to clients as `data.errorData`
      expect(error.cause).toMatchObject({
        data: { errorType: 'InvalidProviderAPIKey', provider: 'elevenlabs' },
      });
    });

    it('reports a rejected key with the InvalidProviderAPIKey copy and the upstream message', async () => {
      textToSpeechMock.mockRejectedValue({
        error: {
          detail: { message: 'Invalid API key', status: 'invalid_api_key' },
          message: 'ElevenLabs API error (401): Invalid API key',
          status: 401,
        },
        errorType: 'InvalidProviderAPIKey',
        provider: 'elevenlabs',
      });

      await expect(
        caller.synthesize({ input: 'Hi', model: 'eleven_v4', provider: 'elevenlabs' }),
      ).rejects.toMatchObject({
        cause: { data: { errorType: 'InvalidProviderAPIKey', provider: 'elevenlabs' } },
        code: 'BAD_GATEWAY',
        message:
          'ElevenLabs API Key is incorrect or empty, please check your ElevenLabs API Key and try again (ElevenLabs API error (401): Invalid API key). Set it in Settings → AI Providers → ElevenLabs, or in the server environment.',
      });
    });
  });

  describe.each([
    {
      defaultVoice: 'default',
      invalid: { speed: 2.5 },
      invalidMessage: 'params.speed must be between 0.5 and 2',
      model: 's2.1-pro',
      name: 'Fish Audio',
      provider: 'fishaudio',
    },
    {
      defaultVoice: 'zh_female_vv_uranus_bigtts',
      invalid: { pitch: 13 },
      invalidMessage: 'params.pitch must be between -12 and 12',
      model: 'seed-tts-2.0',
      name: 'Doubao Speech',
      provider: 'doubaospeech',
    },
  ])('provider $provider', ({ defaultVoice, invalid, invalidMessage, model, name, provider }) => {
    it('routes to its runtime with the card default voice', async () => {
      textToSpeechMock.mockResolvedValue({
        audio: new Uint8Array([4, 5]).buffer,
        format: 'mp3',
        usage: { inputCharacters: 2 },
      });

      const res = await caller.synthesize({ input: 'Hi', model, provider });

      expect(initModelRuntimeFromDB).toHaveBeenCalledWith(
        expect.anything(),
        'u1',
        provider,
        undefined,
      );
      expect(textToSpeechMock).toHaveBeenCalledWith(
        { input: 'Hi', model, params: {}, voice: defaultVoice, voiceIsDefault: true },
        { metadata: { trigger: 'tts' }, user: 'u1' },
      );
      expect(res).toMatchObject({ format: 'mp3', mimeType: 'audio/mpeg' });
    });

    it('rejects invalid params before calling the runtime', async () => {
      await expect(
        caller.synthesize({ input: 'Hi', model, params: invalid, provider }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: expect.stringContaining(invalidMessage),
      });
      expect(textToSpeechMock).not.toHaveBeenCalled();
    });

    it('reports missing credentials with the InvalidProviderAPIKey copy', async () => {
      vi.mocked(initModelRuntimeFromDB).mockRejectedValueOnce({
        errorType: 'InvalidProviderAPIKey',
      });

      const error = await caller.synthesize({ input: 'Hi', model, provider }).catch((e) => e);

      expect(error).toMatchObject({
        code: 'BAD_GATEWAY',
        message: `${name} API Key is incorrect or empty, please check your ${name} API Key and try again. Set it in Settings → AI Providers → ${name}, or in the server environment.`,
      });
      expect(error.cause).toMatchObject({ data: { errorType: 'InvalidProviderAPIKey', provider } });
    });
  });
});

describe('ttsRouter.synthesize saved default voice', () => {
  it('uses the default voice saved in the model settings when the request names none', async () => {
    findByIdAndProviderMock.mockResolvedValueOnce({ settings: { ttsVoice: 'Puck' } });

    await caller.synthesize({ input: '你好', model: 'gemini-3.8-flash-tts', provider: 'google' });

    expect(findByIdAndProviderMock).toHaveBeenCalledWith('gemini-3.8-flash-tts', 'google');
    expect(textToSpeechMock.mock.calls[0][0]).toMatchObject({
      voice: 'Puck',
      voiceIsDefault: false,
    });
  });

  it('lets an explicit request voice win without reading the saved one', async () => {
    await caller.synthesize({
      input: 'hello',
      model: 'gemini-3.8-flash-tts',
      provider: 'google',
      voice: 'Zephyr',
    });

    expect(findByIdAndProviderMock).not.toHaveBeenCalled();
    expect(textToSpeechMock.mock.calls[0][0]).toMatchObject({ voice: 'Zephyr' });
  });

  it('falls back to the card default when nothing is saved', async () => {
    findByIdAndProviderMock.mockResolvedValueOnce(undefined);

    await caller.synthesize({ input: 'hello', model: 'gemini-3.8-flash-tts', provider: 'google' });

    expect(textToSpeechMock.mock.calls[0][0]).toMatchObject({
      voice: 'Kore',
      voiceIsDefault: true,
    });
  });

  it("ignores a saved voice that is not in the model's catalog", async () => {
    findByIdAndProviderMock.mockResolvedValueOnce({ settings: { ttsVoice: 'RetiredVoice' } });

    await caller.synthesize({ input: 'hello', model: 'gemini-3.8-flash-tts', provider: 'google' });

    expect(textToSpeechMock.mock.calls[0][0]).toMatchObject({ voice: 'Kore' });
  });

  it('accepts any saved voice for a model without a built-in catalog', async () => {
    findByIdAndProviderMock.mockResolvedValueOnce({ settings: { ttsVoice: 'my-clone' } });

    await caller.synthesize({ input: 'hello', model: 'my-custom-tts', provider: 'openai' });

    expect(textToSpeechMock.mock.calls[0][0]).toMatchObject({ voice: 'my-clone' });
  });

  it('still synthesizes with the card default when reading the preference fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    findByIdAndProviderMock.mockRejectedValueOnce(new Error('db down'));

    await caller.synthesize({ input: 'hello', model: 'gemini-3.8-flash-tts', provider: 'google' });

    expect(textToSpeechMock.mock.calls[0][0]).toMatchObject({ voice: 'Kore' });
    consoleError.mockRestore();
  });
});

describe('ttsRouter.synthesize provider resolution', () => {
  it("uses the built-in card's provider when the request names none", async () => {
    await caller.synthesize({ input: 'hello', model: 'gemini-3.8-flash-tts' });

    expect(initModelRuntimeFromDB).toHaveBeenCalledWith(
      expect.anything(),
      'u1',
      'google',
      undefined,
    );
  });

  it('splits a provider-prefixed model reference', async () => {
    await caller.synthesize({ input: 'hello', model: 'google/gemini-3.8-flash-tts' });

    expect(initModelRuntimeFromDB).toHaveBeenCalledWith(
      expect.anything(),
      'u1',
      'google',
      undefined,
    );
    expect(textToSpeechMock.mock.calls[0][0]).toMatchObject({ model: 'gemini-3.8-flash-tts' });
  });

  it('keeps OpenAI as the fallback for an unknown bare model id', async () => {
    await caller.synthesize({ input: 'hello', model: 'my-custom-tts' });

    expect(initModelRuntimeFromDB).toHaveBeenCalledWith(
      expect.anything(),
      'u1',
      'openai',
      undefined,
    );
  });
});
