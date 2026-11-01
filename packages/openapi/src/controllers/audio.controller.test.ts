import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const synthesizeMock = vi.fn();

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => ({})) }));
vi.mock('@/server/services/tts', async () => {
  class TTSRequestError extends Error {
    readonly name = 'TTSRequestError';
    constructor(
      message: string,
      readonly reason: string,
    ) {
      super(message);
    }
  }
  class TTSProviderError extends Error {
    readonly name = 'TTSProviderError';
    constructor(
      message: string,
      readonly errorType?: string,
      readonly detail?: unknown,
    ) {
      super(message);
    }
  }
  return {
    INLINE_TTS_AUDIO_FORMATS: ['mp3', 'opus', 'aac'],
    resolveTTSModelRef: (model: string, provider?: string) =>
      provider
        ? { model, provider }
        : model.startsWith('lobehub/')
          ? { model: model.slice('lobehub/'.length), provider: 'lobehub' }
          : { model, provider: 'openai' },
    TTSProviderError,
    TTSRequestError,
    TTSService: class {
      constructor(
        readonly db: unknown,
        readonly userId: string,
        readonly workspaceId?: string,
      ) {}
      synthesize = synthesizeMock;
    },
  };
});

const { AudioController } = await import('./audio.controller');
const { TTSProviderError, TTSRequestError } = await import('@/server/services/tts');

const app = new Hono();
app.use('*', async (c, next) => {
  c.set('userId' as never, 'user-1' as never);
  await next();
});
app.post('/speech', (c) => new AudioController().handleSpeech(c));

const speech = (body: unknown) =>
  app.request('/speech', {
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });

beforeEach(() => {
  synthesizeMock.mockReset();
  synthesizeMock.mockResolvedValue({
    audio: new Uint8Array([7, 8, 9]).buffer,
    format: 'mp3',
    mimeType: 'audio/mpeg',
    usage: { cost: 0.004_524, inputCharacters: 39 },
  });
});

describe('AudioController.handleSpeech', () => {
  it('returns the audio bytes with usage headers for an OpenAI SDK request', async () => {
    const res = await speech({
      input: '主人，今天也要元气满满哦！',
      model: 'lobehub/speech-2.8-hd',
      params: { emotion: 'happy', pitch: 2 },
      response_format: 'mp3',
      speed: 1.1,
      voice: 'Chinese (Mandarin)_Warm_Girl',
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(res.headers.get('X-LobeHub-Usage-Characters')).toBe('39');
    expect(res.headers.get('X-LobeHub-Cost')).toBe('0.004524');
    expect(res.headers.get('X-LobeHub-Provider')).toBe('lobehub');
    expect(res.headers.get('Access-Control-Expose-Headers')).toContain('X-LobeHub-Cost');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([7, 8, 9]));
    expect(synthesizeMock).toHaveBeenCalledWith({
      input: '主人，今天也要元气满满哦！',
      model: 'speech-2.8-hd',
      params: { emotion: 'happy', format: 'mp3', pitch: 2, speed: 1.1 },
      provider: 'lobehub',
      voice: 'Chinese (Mandarin)_Warm_Girl',
    });
  });

  it("accepts OpenAI's { id } voice form and an explicit provider", async () => {
    await speech({
      input: 'hi',
      model: 'speech-2.8-turbo',
      provider: 'minimax',
      voice: { id: 'v1' },
    });

    expect(synthesizeMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'speech-2.8-turbo', provider: 'minimax', voice: 'v1' }),
    );
  });

  it.each(['wav', 'pcm', 'flac'])(
    'refuses %s before synthesizing, with an OpenAI-style error',
    async (format) => {
      const res = await speech({ input: 'hi', model: 'tts-1', response_format: format });

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: {
          message: expect.stringContaining('use one of mp3, opus, aac'),
          param: 'response_format',
          type: 'invalid_request_error',
        },
      });
      expect(synthesizeMock).not.toHaveBeenCalled();
    },
  );

  it('rejects an invalid body without synthesizing', async () => {
    const res = await speech({ model: 'tts-1' });

    expect(res.status).toBe(400);
    expect((await res.json()).error.param).toBe('input');
    expect(synthesizeMock).not.toHaveBeenCalled();
  });

  it('rejects SSE streaming, which is not supported', async () => {
    const res = await speech({ input: 'hi', model: 'tts-1', stream_format: 'sse' });

    expect(res.status).toBe(400);
    expect(synthesizeMock).not.toHaveBeenCalled();
  });

  it('maps invalid params to 400 with the validation message', async () => {
    synthesizeMock.mockRejectedValue(
      new TTSRequestError('params.pitch must be between -12 and 12', 'invalid_params'),
    );

    const res = await speech({
      input: 'hi',
      model: 'lobehub/speech-2.8-hd',
      params: { pitch: 13 },
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatchObject({
      code: 'invalid_params',
      message: 'params.pitch must be between -12 and 12',
    });
  });

  it('surfaces upstream failures as 502 with a readable message', async () => {
    synthesizeMock.mockRejectedValue(
      new TTSProviderError('voice id not exist', 'ProviderBizError'),
    );

    const res = await speech({ input: 'hi', model: 'lobehub/speech-2.8-hd', voice: 'nope' });

    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatchObject({
      code: 'ProviderBizError',
      message: 'voice id not exist',
      type: 'upstream_error',
    });
  });

  it('maps upstream rate limits to 429', async () => {
    synthesizeMock.mockRejectedValue(new TTSProviderError('slow down', 'RateLimitExceeded'));

    const res = await speech({ input: 'hi', model: 'tts-1' });

    expect(res.status).toBe(429);
    expect((await res.json()).error.type).toBe('rate_limit_error');
  });

  it('keeps the status of server-side refusals such as an exhausted budget', async () => {
    synthesizeMock.mockRejectedValue(
      Object.assign(new Error('Insufficient credits'), {
        code: 'PAYMENT_REQUIRED',
        name: 'TRPCError',
      }),
    );

    const res = await speech({ input: 'hi', model: 'tts-1' });

    expect(res.status).toBe(402);
    expect((await res.json()).error.message).toBe('Insufficient credits');
  });
});
