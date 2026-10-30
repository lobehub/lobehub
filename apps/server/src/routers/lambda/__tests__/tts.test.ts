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

const caller = ttsRouter.createCaller({ jwtPayload: { userId: 'u1' }, userId: 'u1' } as any);

const usage = { cost: 0.000_075, inputCharacters: 5 };

beforeEach(() => {
  textToSpeechMock.mockResolvedValue({
    audio: new Uint8Array([1, 2, 3]).buffer,
    format: 'wav',
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
      params: { format: 'wav', speed: 1.5 },
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
      { input: 'hello', model: 'tts-1', params: { format: 'wav', speed: 1.5 }, voice: 'nova' },
      { metadata: { trigger: 'tts' }, user: 'u1' },
    );
    expect(res).toEqual({
      audioBase64: Buffer.from([1, 2, 3]).toString('base64'),
      format: 'wav',
      mimeType: 'audio/wav',
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
});
