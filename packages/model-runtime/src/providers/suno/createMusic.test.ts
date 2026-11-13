// @vitest-environment node
import { AgentRuntimeErrorType } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ModelRuntime } from '../../core/ModelRuntime';
import {
  buildSunoMusicRequest,
  createSunoMusic,
  pollSunoMusicStatus,
  resolveSunoModelVersion,
  type SunoMusicOptions,
} from './createMusic';
import { LobeSunoAI } from './index';

const options: SunoMusicOptions = {
  apiKey: 'suno-key',
  baseURL: 'https://api.sunoapi.org',
  callbackUrl: 'https://example.com/hook',
  provider: 'suno',
};

const envelope = (data: unknown, code = 200, msg = 'success', status = 200) =>
  new Response(JSON.stringify({ code, data, msg }), {
    headers: { 'content-type': 'application/json' },
    status,
  });

const submitted = () => envelope({ taskId: 'task-1' });
const record = (status: string, extra: Record<string, unknown> = {}) =>
  envelope({ status, taskId: 'task-1', ...extra });
const succeeded = () =>
  record('SUCCESS', {
    response: {
      sunoData: [
        {
          audioUrl: 'https://cdn.suno.test/a.mp3',
          duration: 182.4,
          id: 'clip-a',
          imageUrl: 'https://cdn.suno.test/a.jpg',
          streamAudioUrl: 'https://cdn.suno.test/a-stream',
          tags: 'city pop',
          title: 'Night Drive',
        },
        // snake_case variant of the same gateway
        { audio_url: 'https://cdn.suno.test/b.mp3', id: 'clip-b', title: 'Night Drive' },
      ],
      taskId: 'task-1',
    },
  });

describe('resolveSunoModelVersion', () => {
  it('maps LobeHub ids to Suno versions and passes Suno versions through', () => {
    expect(resolveSunoModelVersion('suno-v4.5-plus')).toBe('V4_5PLUS');
    expect(resolveSunoModelVersion('suno-v5')).toBe('V5');
    expect(resolveSunoModelVersion('V6_WILD')).toBe('V6_WILD');
  });
});

describe('buildSunoMusicRequest', () => {
  it('uses custom mode for custom-only controls and keeps lyrics, style and prompt', () => {
    expect(
      buildSunoMusicRequest(
        {
          model: 'suno-v5',
          params: {
            lyrics: '[Verse]\nneon lights',
            negativeStyle: 'metal',
            prompt: 'night drive',
            style: 'city pop, female vocals',
            title: 'Night Drive',
            vocalGender: 'f',
          },
        },
        'V5',
        'https://example.com/hook',
      ),
    ).toEqual({
      callBackUrl: 'https://example.com/hook',
      customMode: true,
      instrumental: false,
      lyrics: '[Verse]\nneon lights',
      model: 'V5',
      negativeTags: 'metal',
      prompt: 'night drive',
      style: 'city pop, female vocals',
      title: 'Night Drive',
      vocalGender: 'f',
    });
  });

  it('sends an instrumental custom track with a style and title', () => {
    expect(
      buildSunoMusicRequest(
        { model: 'suno-v5', params: { instrumental: true, style: 'ambient', title: 'Drift' } },
        'V5',
      ),
    ).toEqual({
      customMode: true,
      instrumental: true,
      model: 'V5',
      style: 'ambient',
      title: 'Drift',
    });
  });

  it('uses non-custom mode for prompt with style, lyrics or reference audio', () => {
    expect(
      buildSunoMusicRequest(
        { model: 'suno-v4.5', params: { prompt: 'a happy song', style: 'pop' } },
        'V4_5',
      ),
    ).toEqual({
      customMode: false,
      instrumental: false,
      model: 'V4_5',
      prompt: 'a happy song',
      style: 'pop',
    });
    expect(
      buildSunoMusicRequest({ model: 'suno-v5', params: { lyrics: '[Verse]\nla la' } }, 'V5'),
    ).toEqual({ customMode: false, instrumental: false, lyrics: '[Verse]\nla la', model: 'V5' });
    expect(
      buildSunoMusicRequest(
        { model: 'suno-v5', params: { referenceAudioUrl: 'https://x/ref.mp3' } },
        'V5',
      ),
    ).toEqual({
      audioUrls: ['https://x/ref.mp3'],
      customMode: false,
      instrumental: false,
      model: 'V5',
    });
  });

  it('applies negativeStyle / vocalGender through custom mode instead of dropping them', () => {
    expect(
      buildSunoMusicRequest(
        { model: 'suno-v5', params: { negativeStyle: 'metal', vocalGender: 'm' } },
        'V5',
      ),
    ).toEqual({
      customMode: true,
      instrumental: false,
      model: 'V5',
      negativeTags: 'metal',
      vocalGender: 'm',
    });
  });

  it('rejects requests Suno would refuse', () => {
    expect(() =>
      buildSunoMusicRequest({ model: 'suno-v5', params: { prompt: 'a happy song' } }, 'V5'),
    ).toThrow(/a prompt alone is not accepted/);
    expect(() => buildSunoMusicRequest({ model: 'suno-v5', params: {} }, 'V5')).toThrow(
      /needs a style, lyrics, or reference audio/,
    );
    expect(() =>
      buildSunoMusicRequest({ model: 'suno-v5', params: { prompt: 'cats', title: 'Song' } }, 'V5'),
    ).toThrow(/needs lyrics, a style, or a negative style/);
    expect(() =>
      buildSunoMusicRequest(
        {
          model: 'suno-v5',
          params: { referenceAudioUrl: 'https://x/ref.mp3', title: 'Song', style: 'pop' },
        },
        'V5',
      ),
    ).toThrow(/reference audio only without/);
  });
});

describe('createSunoMusic', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('submits a task and returns the pending task id', async () => {
    fetchMock.mockResolvedValue(submitted());

    const result = await createSunoMusic(
      {
        model: 'suno-v5',
        params: { lyrics: 'la la', style: 'pop', title: 'Song' },
      },
      { ...options, callbackUrl: 'https://example.com/hook' },
    );

    expect(result).toEqual({ inferenceId: 'task-1', status: 'pending' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.sunoapi.org/api/v1/generate');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer suno-key');
    expect(JSON.parse(init.body)).toEqual({
      callBackUrl: 'https://example.com/hook',
      customMode: true,
      instrumental: false,
      lyrics: 'la la',
      model: 'V5',
      style: 'pop',
      title: 'Song',
    });
  });

  it('polls until the task succeeds when waitForCompletion is set', async () => {
    fetchMock
      .mockResolvedValueOnce(submitted())
      .mockResolvedValueOnce(record('PENDING'))
      .mockResolvedValueOnce(record('TEXT_SUCCESS'))
      .mockResolvedValueOnce(record('FIRST_SUCCESS'))
      .mockResolvedValueOnce(succeeded());

    const result = await createSunoMusic(
      { model: 'suno-v5', params: { prompt: 'a happy song', style: 'pop' } },
      { ...options, pollIntervalMs: 0, waitForCompletion: true },
    );

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.sunoapi.org/api/v1/generate/record-info?taskId=task-1',
    );
    expect(result).toEqual({
      inferenceId: 'task-1',
      status: 'success',
      tracks: [
        {
          audioUrl: 'https://cdn.suno.test/a.mp3',
          contentType: 'audio/mpeg',
          duration: 182.4,
          id: 'clip-a',
          imageUrl: 'https://cdn.suno.test/a.jpg',
          streamAudioUrl: 'https://cdn.suno.test/a-stream',
          tags: 'city pop',
          title: 'Night Drive',
        },
        {
          audioUrl: 'https://cdn.suno.test/b.mp3',
          contentType: 'audio/mpeg',
          id: 'clip-b',
          title: 'Night Drive',
        },
      ],
    });
  });

  it('throws a timeout after the maximum number of polls', async () => {
    fetchMock.mockResolvedValueOnce(submitted()).mockImplementation(async () => record('PENDING'));

    await expect(
      createSunoMusic(
        { model: 'suno-v5', params: { prompt: 'a happy song', style: 'pop' } },
        { ...options, maxAttempts: 3, pollIntervalMs: 0, waitForCompletion: true },
      ),
    ).rejects.toMatchObject({
      error: { maxAttempts: 3, taskId: 'task-1' },
      errorType: AgentRuntimeErrorType.ProviderNetworkError,
      provider: 'suno',
    });
    // 1 submit + 3 polls
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('throws a timeout once the time budget is spent', async () => {
    fetchMock.mockResolvedValueOnce(submitted()).mockImplementation(async () => record('PENDING'));

    await expect(
      createSunoMusic(
        { model: 'suno-v5', params: { prompt: 'a happy song', style: 'pop' } },
        { ...options, pollIntervalMs: 50, timeoutMs: 10, waitForCompletion: true },
      ),
    ).rejects.toMatchObject({
      error: { timeoutMs: 10 },
      errorType: AgentRuntimeErrorType.ProviderNetworkError,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces a failed task while waiting', async () => {
    fetchMock
      .mockResolvedValueOnce(submitted())
      .mockResolvedValueOnce(
        record('GENERATE_AUDIO_FAILED', { errorCode: 500, errorMessage: 'audio failed' }),
      );

    await expect(
      createSunoMusic(
        { model: 'suno-v5', params: { prompt: 'a happy song', style: 'pop' } },
        { ...options, pollIntervalMs: 0, waitForCompletion: true },
      ),
    ).rejects.toMatchObject({
      error: { message: 'audio failed', taskId: 'task-1' },
      errorType: AgentRuntimeErrorType.ProviderBizError,
      provider: 'suno',
    });
  });

  it.each([
    [
      'HTTP 401',
      () => envelope(null, 401, 'Unauthorized', 401),
      AgentRuntimeErrorType.InvalidProviderAPIKey,
    ],
    [
      'code 401 with HTTP 200',
      () => envelope(null, 401, 'invalid key'),
      AgentRuntimeErrorType.InvalidProviderAPIKey,
    ],
    [
      'code 429',
      () => envelope(null, 429, 'Insufficient credits'),
      AgentRuntimeErrorType.InsufficientQuota,
    ],
    [
      'code 430',
      () => envelope(null, 430, 'too frequent'),
      AgentRuntimeErrorType.RateLimitExceeded,
    ],
    [
      'code 455',
      () => envelope(null, 455, 'maintenance'),
      AgentRuntimeErrorType.ProviderServiceUnavailable,
    ],
    [
      'non-JSON 502',
      () => new Response('<html>bad gateway</html>', { status: 502 }),
      AgentRuntimeErrorType.UpstreamMalformedResponse,
    ],
  ])('maps %s on submit', async (_label, response, errorType) => {
    fetchMock.mockResolvedValue(response());

    await expect(
      createSunoMusic(
        { model: 'suno-v5', params: { prompt: 'a happy song', style: 'pop' } },
        options,
      ),
    ).rejects.toMatchObject({ errorType, provider: 'suno' });
  });

  it('rejects a submission without a callback URL before calling Suno', async () => {
    await expect(
      createSunoMusic(
        { model: 'suno-v5', params: { prompt: 'a happy song', style: 'pop' } },
        { ...options, callbackUrl: undefined },
      ),
    ).rejects.toMatchObject({
      error: { message: expect.stringContaining('callbackUrl') },
      errorType: AgentRuntimeErrorType.InvalidRequestFormat,
      provider: 'suno',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('times out a stalled status request instead of waiting forever', async () => {
    fetchMock.mockResolvedValueOnce(submitted()).mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );

    await expect(
      createSunoMusic(
        { model: 'suno-v5', params: { prompt: 'a happy song', style: 'pop' } },
        { ...options, pollIntervalMs: 0, timeoutMs: 50, waitForCompletion: true },
      ),
    ).rejects.toMatchObject({
      error: { taskId: 'task-1', timeoutMs: 50 },
      errorType: AgentRuntimeErrorType.ProviderNetworkError,
    });
    expect(fetchMock.mock.calls[1][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects a response without taskId', async () => {
    fetchMock.mockResolvedValue(envelope({}));

    await expect(
      createSunoMusic(
        { model: 'suno-v5', params: { prompt: 'a happy song', style: 'pop' } },
        options,
      ),
    ).rejects.toMatchObject({ errorType: AgentRuntimeErrorType.UpstreamMalformedResponse });
  });
});

describe('pollSunoMusicStatus', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(['PENDING', 'TEXT_SUCCESS', 'FIRST_SUCCESS'])('reports %s as pending', async (status) => {
    fetchMock.mockResolvedValue(record(status));

    await expect(pollSunoMusicStatus('task-1', options)).resolves.toEqual({ status: 'pending' });
  });

  it('returns the tracks of a finished task', async () => {
    fetchMock.mockResolvedValue(succeeded());

    const result = await pollSunoMusicStatus('task-1', options);

    expect(result.status).toBe('success');
    expect(result.status === 'success' && result.tracks.map((t) => t.audioUrl)).toEqual([
      'https://cdn.suno.test/a.mp3',
      'https://cdn.suno.test/b.mp3',
    ]);
  });

  it.each([
    ['CREATE_TASK_FAILED', AgentRuntimeErrorType.ProviderBizError],
    ['GENERATE_AUDIO_FAILED', AgentRuntimeErrorType.ProviderBizError],
    ['CALLBACK_EXCEPTION', AgentRuntimeErrorType.ProviderBizError],
    ['SENSITIVE_WORD_ERROR', AgentRuntimeErrorType.ContentModeration],
  ])('reports %s as failed with %s', async (status, errorType) => {
    fetchMock.mockResolvedValue(record(status, { errorMessage: `${status} detail` }));

    await expect(pollSunoMusicStatus('task-1', options)).resolves.toEqual({
      error: `${status} detail`,
      errorType,
      status: 'failed',
    });
  });

  it.each([
    ['data: null', () => envelope(null)],
    ['missing status', () => envelope({ taskId: 'task-1' })],
  ])('reports a response with %s as malformed instead of pending', async (_label, response) => {
    fetchMock.mockResolvedValue(response());

    await expect(pollSunoMusicStatus('task-1', options)).resolves.toMatchObject({
      errorType: AgentRuntimeErrorType.UpstreamMalformedResponse,
      status: 'failed',
    });
  });

  it('reports a success without audio as a malformed response', async () => {
    fetchMock.mockResolvedValue(record('SUCCESS', { response: { sunoData: [] } }));

    await expect(pollSunoMusicStatus('task-1', options)).resolves.toMatchObject({
      errorType: AgentRuntimeErrorType.UpstreamMalformedResponse,
      status: 'failed',
    });
  });

  it('throws an invalid API key error when polling is unauthorized', async () => {
    fetchMock.mockResolvedValue(envelope(null, 401, 'Unauthorized', 401));

    await expect(pollSunoMusicStatus('task-1', options)).rejects.toMatchObject({
      errorType: AgentRuntimeErrorType.InvalidProviderAPIKey,
      provider: 'suno',
    });
  });
});

describe('LobeSunoAI', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requires an API key', () => {
    expect(() => new LobeSunoAI({})).toThrow();
  });

  it('is reachable through ModelRuntime.initializeWithProvider("suno")', async () => {
    fetchMock.mockResolvedValueOnce(submitted()).mockResolvedValueOnce(succeeded());

    const runtime = ModelRuntime.initializeWithProvider('suno', {
      apiKey: 'suno-key',
      baseURL: 'https://gateway.example.com/',
    });

    const created = await runtime.createMusic(
      { model: 'suno-v5', params: { prompt: 'a happy song', style: 'pop' } },
      { callbackUrl: 'https://example.com/hook' },
    );
    expect(created).toEqual({ inferenceId: 'task-1', status: 'pending' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://gateway.example.com/api/v1/generate');

    const polled = await runtime.handlePollMusicStatus('task-1', 'suno-v5');
    expect(polled?.status).toBe('success');
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://gateway.example.com/api/v1/generate/record-info?taskId=task-1',
    );
  });

  it('returns undefined from ModelRuntime for runtimes without music support', async () => {
    const runtime = ModelRuntime.initializeWithProvider('elevenlabs', { apiKey: 'k' });

    await expect(
      runtime.createMusic({ model: 'x', params: { prompt: 'a' } }),
    ).resolves.toBeUndefined();
  });
});
