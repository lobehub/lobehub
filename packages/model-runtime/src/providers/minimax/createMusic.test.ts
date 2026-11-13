// @vitest-environment node
import { AgentRuntimeErrorType } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildMiniMaxMusicRequest,
  createMiniMaxMusic,
  LobeMinimaxMusicAI,
  type MiniMaxMusicOptions,
} from './createMusic';
import { LobeMinimaxAI } from './index';

const options: MiniMaxMusicOptions = {
  apiKey: 'test-key',
  baseURL: 'https://api.minimaxi.com/v1',
  provider: 'minimax',
};

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init,
  });

const okResponse = (audio: string, overrides: Record<string, unknown> = {}) =>
  jsonResponse({
    base_resp: { status_code: 0, status_msg: 'success' },
    data: { audio, status: 2 },
    extra_info: { music_duration: 30_500, music_sample_rate: 44_100 },
    trace_id: 'trace-1',
    ...overrides,
  });

const sseResponse = (events: unknown[]) => {
  const encoder = new TextEncoder();
  const text = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
  // Split mid-event to prove the reader buffers partial lines.
  const cut = Math.floor(text.length / 2);
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(text.slice(0, cut)));
        controller.enqueue(encoder.encode(text.slice(cut)));
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
};

const toHex = (buffer: ArrayBuffer) => Buffer.from(buffer).toString('hex');

describe('buildMiniMaxMusicRequest', () => {
  it('maps prompt, lyrics and audio settings onto music_generation fields', () => {
    expect(
      buildMiniMaxMusicRequest(
        {
          model: 'music-2.6',
          params: {
            bitrate: 256_000,
            format: 'wav',
            lyrics: '[Verse]\nhello',
            prompt: 'city pop, night drive',
            sampleRate: 44_100,
            watermark: true,
          },
        },
        'music-2.6',
      ),
    ).toEqual({
      aigc_watermark: true,
      audio_setting: { bitrate: 256_000, format: 'wav', sample_rate: 44_100 },
      lyrics: '[Verse]\nhello',
      model: 'music-2.6',
      output_format: 'url',
      prompt: 'city pop, night drive',
    });
  });

  it('maps instrumental, lyrics optimizer and the reference audio URL', () => {
    expect(
      buildMiniMaxMusicRequest(
        {
          model: 'music-cover',
          params: {
            instrumental: true,
            lyricsOptimizer: true,
            outputFormat: 'hex',
            prompt: 'acoustic cover',
            referenceAudioUrl: 'https://example.com/ref.mp3',
          },
        },
        'music-cover',
      ),
    ).toEqual({
      audio_url: 'https://example.com/ref.mp3',
      is_instrumental: true,
      lyrics_optimizer: true,
      model: 'music-cover',
      output_format: 'hex',
      prompt: 'acoustic cover',
    });
  });

  it('maps base64 reference audio and forces hex output when streaming', () => {
    expect(
      buildMiniMaxMusicRequest(
        {
          model: 'music-cover',
          params: { outputFormat: 'url', referenceAudioBase64: 'AAAA', stream: true },
        },
        'music-cover',
      ),
    ).toEqual({
      audio_base64: 'AAAA',
      model: 'music-cover',
      output_format: 'hex',
      stream: true,
    });
  });

  it('rejects an empty request and conflicting reference audio', () => {
    expect(() => buildMiniMaxMusicRequest({ model: 'music-2.6', params: {} }, 'music-2.6')).toThrow(
      /prompt, lyrics, or reference audio/,
    );
    expect(() =>
      buildMiniMaxMusicRequest(
        {
          model: 'music-cover',
          params: { referenceAudioBase64: 'AAAA', referenceAudioUrl: 'https://x/a.mp3' },
        },
        'music-cover',
      ),
    ).toThrow(/either referenceAudioUrl or referenceAudioBase64/);
  });
});

describe('createMiniMaxMusic', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the hosted audio URL from a synchronous url response', async () => {
    fetchMock.mockResolvedValue(okResponse('https://cdn.minimax.io/music/song.mp3'));

    const result = await createMiniMaxMusic(
      { model: 'music-2.6', params: { lyrics: '[Verse]\nla la', prompt: 'pop' } },
      options,
    );

    expect(result).toEqual({
      inferenceId: 'trace-1',
      status: 'success',
      tracks: [
        {
          audioUrl: 'https://cdn.minimax.io/music/song.mp3',
          contentType: 'audio/mpeg',
          duration: 30.5,
          id: 'trace-1',
        },
      ],
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.minimaxi.com/v1/music_generation');
    expect(init.headers.Authorization).toBe('Bearer test-key');
    expect(JSON.parse(init.body)).toMatchObject({
      lyrics: '[Verse]\nla la',
      model: 'music-2.6',
      output_format: 'url',
      prompt: 'pop',
    });
  });

  it('decodes hex audio into bytes', async () => {
    fetchMock.mockResolvedValue(okResponse('49443303'));

    const result = await createMiniMaxMusic(
      { model: 'music-2.6', params: { format: 'wav', outputFormat: 'hex', prompt: 'lofi' } },
      options,
    );

    expect(result.status).toBe('success');
    const track = result.status === 'success' ? result.tracks[0] : undefined;
    expect(track?.audioUrl).toBeUndefined();
    expect(track?.contentType).toBe('audio/wav');
    expect(toHex(track!.audio!)).toBe('49443303');
  });

  it('assembles streamed hex chunks when the final event has no audio', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        { base_resp: { status_code: 0 }, data: { audio: '4944', status: 1 } },
        { base_resp: { status_code: 0 }, data: { audio: '3303', status: 1 } },
        {
          base_resp: { status_code: 0 },
          data: { status: 2 },
          extra_info: { music_duration: 1000 },
          trace_id: 'trace-stream',
        },
      ]),
    );

    const result = await createMiniMaxMusic(
      { model: 'music-2.6', params: { prompt: 'lofi', stream: true } },
      options,
    );

    expect(result.status).toBe('success');
    const track = result.status === 'success' ? result.tracks[0] : undefined;
    expect(toHex(track!.audio!)).toBe('49443303');
    expect(track?.duration).toBe(1);
    expect(result.inferenceId).toBe('trace-stream');
  });

  it('prefers the full audio of the final streamed event', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        { base_resp: { status_code: 0 }, data: { audio: '4944', status: 1 } },
        { base_resp: { status_code: 0 }, data: { audio: '49443303', status: 2 } },
      ]),
    );

    const result = await createMiniMaxMusic(
      { model: 'music-2.6', params: { prompt: 'lofi', stream: true } },
      options,
    );

    const track = result.status === 'success' ? result.tracks[0] : undefined;
    expect(toHex(track!.audio!)).toBe('49443303');
  });

  it('maps a plain JSON error body on a streamed request', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ base_resp: { status_code: 1008, status_msg: 'insufficient balance' } }),
    );

    await expect(
      createMiniMaxMusic({ model: 'music-2.6', params: { prompt: 'lofi', stream: true } }, options),
    ).rejects.toMatchObject({
      error: { message: 'MiniMax music API error: insufficient balance' },
      errorType: AgentRuntimeErrorType.InsufficientQuota,
    });
  });

  it('rejects a stream that closes before the terminal event', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        { base_resp: { status_code: 0 }, data: { audio: '4944', status: 1 } },
        { base_resp: { status_code: 0 }, data: { audio: '3303', status: 1 } },
      ]),
    );

    await expect(
      createMiniMaxMusic({ model: 'music-2.6', params: { prompt: 'lofi', stream: true } }, options),
    ).rejects.toMatchObject({
      error: { message: 'MiniMax music stream ended before the song finished' },
      errorType: AgentRuntimeErrorType.ProviderNetworkError,
    });
  });

  it('fails when the task is still synthesizing', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ base_resp: { status_code: 0 }, data: { audio: '', status: 1 } }),
    );

    await expect(
      createMiniMaxMusic({ model: 'music-2.6', params: { prompt: 'lofi' } }, options),
    ).rejects.toMatchObject({
      error: { message: 'MiniMax music task did not finish (status 1)' },
      errorType: AgentRuntimeErrorType.ProviderBizError,
      provider: 'minimax',
    });
  });

  it('reports malformed audio as an upstream response error', async () => {
    fetchMock.mockResolvedValue(okResponse('not-hex'));

    await expect(
      createMiniMaxMusic({ model: 'music-2.6', params: { prompt: 'lofi' } }, options),
    ).rejects.toMatchObject({ errorType: AgentRuntimeErrorType.UpstreamMalformedResponse });
  });

  it.each([
    [1004, AgentRuntimeErrorType.InvalidProviderAPIKey],
    [2049, AgentRuntimeErrorType.InvalidProviderAPIKey],
    [1008, AgentRuntimeErrorType.InsufficientQuota],
    [1002, AgentRuntimeErrorType.RateLimitExceeded],
    [1026, AgentRuntimeErrorType.ContentModeration],
    [2013, AgentRuntimeErrorType.InvalidRequestFormat],
    [9999, AgentRuntimeErrorType.ProviderBizError],
  ])('maps base_resp %d to %s', async (statusCode, errorType) => {
    fetchMock.mockResolvedValue(
      jsonResponse({ base_resp: { status_code: statusCode, status_msg: 'nope' }, trace_id: 't' }),
    );

    await expect(
      createMiniMaxMusic({ model: 'music-2.6', params: { prompt: 'lofi' } }, options),
    ).rejects.toMatchObject({
      error: { base_resp: { status_code: statusCode }, message: 'MiniMax music API error: nope' },
      errorType,
      provider: 'minimax',
    });
  });

  it('maps an HTTP 401 to an invalid API key', async () => {
    fetchMock.mockResolvedValue(new Response('unauthorized', { status: 401 }));

    await expect(
      createMiniMaxMusic({ model: 'music-2.6', params: { prompt: 'lofi' } }, options),
    ).rejects.toMatchObject({
      error: { status: 401 },
      errorType: AgentRuntimeErrorType.InvalidProviderAPIKey,
    });
  });

  it('rejects an invalid request before calling MiniMax', async () => {
    await expect(
      createMiniMaxMusic({ model: 'music-2.6', params: {} }, options),
    ).rejects.toMatchObject({ errorType: AgentRuntimeErrorType.InvalidRequestFormat });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('LobeMinimaxMusicAI', () => {
  it('requires an API key', () => {
    expect(() => new LobeMinimaxMusicAI({ baseURL: options.baseURL, id: 'minimax' })).toThrow();
  });
});

describe('LobeMinimaxAI createMusic routing', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(okResponse('https://cdn.minimax.io/music/song.mp3'));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['https://api.minimax.io/anthropic', 'https://api.minimax.io/v1/music_generation'],
    [undefined, 'https://api.minimaxi.com/v1/music_generation'],
  ])('sends music-* models from baseURL %s to %s', async (baseURL, expectedUrl) => {
    const runtime = new LobeMinimaxAI({ apiKey: 'test-key', baseURL });

    const result = await runtime.createMusic({ model: 'music-2.6', params: { prompt: 'pop' } });

    expect(result.status).toBe('success');
    expect(fetchMock.mock.calls[0][0]).toBe(expectedUrl);
  });
});
