// @vitest-environment node
import { AgentRuntimeErrorType } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildFalMusicInput, parseFalMusicOutput, toFalMusicErrorType } from './createMusic';
import { LobeFalAI } from './index';

vi.mock('@fal-ai/client', () => ({
  createFalClient: vi.fn(() => ({ queue: {} })),
  fal: { config: vi.fn(), subscribe: vi.fn() },
}));

const QUEUE = 'https://queue.fal.run';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

const requestOf = (index: number) => {
  const [url, init] = fetchMock.mock.calls[index];
  return {
    body: init?.body ? JSON.parse(init.body as string) : undefined,
    headers: init?.headers as Record<string, string>,
    method: init?.method ?? 'GET',
    url: String(url),
  };
};

describe('buildFalMusicInput', () => {
  it('maps MiniMax Music 2.6 lyrics, style and audio settings', () => {
    expect(
      buildFalMusicInput('fal-ai/minimax-music/v2.6', {
        bitrate: 128_000,
        format: 'mp3',
        lyrics: '[verse]\nhello',
        prompt: 'City pop night drive',
        sampleRate: 44_100,
        style: 'female vocal',
      }),
    ).toEqual({
      audio_setting: { bitrate: 128_000, format: 'mp3', sample_rate: 44_100 },
      lyrics: '[verse]\nhello',
      prompt: 'City pop night drive, female vocal',
    });
  });

  it('lets MiniMax Music 2.6 write lyrics for a vocal track without any, and sends none for instrumentals', () => {
    expect(buildFalMusicInput('fal-ai/minimax-music/v2.6', { prompt: 'lo-fi beat' })).toEqual({
      lyrics_optimizer: true,
      prompt: 'lo-fi beat',
    });
    expect(
      buildFalMusicInput('fal-ai/minimax-music/v2.6', {
        instrumental: true,
        lyrics: 'ignored',
        prompt: 'lo-fi beat',
      }),
    ).toEqual({ is_instrumental: true, prompt: 'lo-fi beat' });
  });

  it('maps ACE-Step 1.5 style tags into the caption and instrumental into its lyrics tag', () => {
    expect(
      buildFalMusicInput('fal-ai/ace-step-1.5', {
        duration: 45,
        instrumental: true,
        lyrics: 'ignored',
        prompt: 'calm piano',
        style: 'ambient, 70 bpm',
      }),
    ).toEqual({
      duration: 45,
      lyrics: '[Instrumental]',
      num_outputs: 1,
      prompt: 'calm piano, ambient, 70 bpm',
    });
  });

  it('sends the lyrics as the legacy MiniMax prompt together with the reference audio', () => {
    expect(
      buildFalMusicInput('fal-ai/minimax-music', {
        lyrics: '## hello world ##',
        prompt: 'unused description',
        referenceAudioUrl: 'https://cdn/ref.mp3',
      }),
    ).toEqual({ prompt: '## hello world ##', reference_audio_url: 'https://cdn/ref.mp3' });
  });

  it('maps MiniMax Music 3 lyrics and duration', () => {
    expect(
      buildFalMusicInput('minimax/music-3', { duration: 30, lyrics: 'la la', prompt: 'pop' }),
    ).toEqual({ duration: 30, lyrics: 'la la', prompt: 'pop' });
  });
});

describe('parseFalMusicOutput', () => {
  it('reads every ACE-Step sample with the reported duration', () => {
    expect(
      parseFalMusicOutput({
        audio: { content_type: 'audio/flac', url: 'https://fal.media/a.flac' },
        audios: [
          { audio: { content_type: 'audio/flac', url: 'https://fal.media/a.flac' }, seed: 1 },
        ],
        duration: 30,
      }),
    ).toEqual([{ audioUrl: 'https://fal.media/a.flac', contentType: 'audio/flac', duration: 30 }]);
  });

  it('ignores a non-audio content type fal sometimes reports', () => {
    expect(
      parseFalMusicOutput({ audio: { content_type: 'image/png', url: 'https://fal.media/o.wav' } }),
    ).toEqual([{ audioUrl: 'https://fal.media/o.wav' }]);
  });
});

describe('toFalMusicErrorType', () => {
  it.each([
    [401, { detail: 'invalid key credentials' }, AgentRuntimeErrorType.InvalidProviderAPIKey],
    [
      403,
      { detail: 'User is locked. Reason: Exhausted balance.' },
      AgentRuntimeErrorType.InsufficientQuota,
    ],
    [403, { detail: 'Not allowed to access this app' }, AgentRuntimeErrorType.PermissionDenied],
    [
      422,
      { detail: [{ msg: 'flagged', type: 'content_policy_violation' }] },
      AgentRuntimeErrorType.ContentModeration,
    ],
    [
      422,
      { detail: [{ msg: 'field required', type: 'missing' }] },
      AgentRuntimeErrorType.ProviderBizError,
    ],
    [429, {}, AgentRuntimeErrorType.RateLimitExceeded],
    [503, {}, AgentRuntimeErrorType.ProviderServiceUnavailable],
  ])('maps HTTP %d', (status, body, expected) => {
    expect(toFalMusicErrorType(status, body)).toBe(expected);
  });
});

describe('LobeFalAI music', () => {
  const runtime = () => new LobeFalAI({ apiKey: 'test-key' });

  it('submits to the queue and returns a pending task keyed by the request path', async () => {
    fetchMock.mockResolvedValueOnce(json({ request_id: 'req-1', status: 'IN_QUEUE' }));

    const result = await runtime().createMusic({
      model: 'fal-ai/ace-step-1.5',
      params: { duration: 30, lyrics: '[verse]\nhi', prompt: 'pop' },
    });

    expect(result).toEqual({
      inferenceId: 'fal-ai/ace-step-1.5/requests/req-1',
      status: 'pending',
    });
    const request = requestOf(0);
    expect(request.url).toBe(`${QUEUE}/fal-ai/ace-step-1.5`);
    expect(request.method).toBe('POST');
    expect(request.headers.Authorization).toBe('Key test-key');
    expect(request.body).toEqual({
      duration: 30,
      lyrics: '[verse]\nhi',
      num_outputs: 1,
      prompt: 'pop',
    });
  });

  it('reports a queued or running task as pending without fetching the result', async () => {
    fetchMock.mockResolvedValueOnce(json({ status: 'IN_PROGRESS' }));

    await expect(
      runtime().handlePollMusicStatus('fal-ai/minimax-music/v2.6/requests/req-2'),
    ).resolves.toEqual({ status: 'pending' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // fal serves status under `<owner>/<app>` only and answers 405 for the full endpoint path
    expect(requestOf(0).url).toBe(`${QUEUE}/fal-ai/minimax-music/requests/req-2/status`);
  });

  it('returns the tracks of a completed task', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(json({ audio: { url: 'https://fal.media/song.mp3' } }));

    await expect(
      runtime().handlePollMusicStatus('fal-ai/minimax-music/v2.6/requests/req-3'),
    ).resolves.toEqual({ status: 'success', tracks: [{ audioUrl: 'https://fal.media/song.mp3' }] });
    expect(requestOf(1).url).toBe(`${QUEUE}/fal-ai/minimax-music/requests/req-3`);
  });

  it('fails a completed task whose result is a provider error', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(
        json({ detail: [{ msg: 'Lyrics are required', type: 'value_error' }] }, 422),
      );

    await expect(
      runtime().handlePollMusicStatus('minimax/music-3/requests/req-4'),
    ).resolves.toEqual({
      error: 'Lyrics are required',
      errorType: AgentRuntimeErrorType.ProviderBizError,
      status: 'failed',
    });
  });

  it('fails a completed task that returned no audio', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(json({ seed: 1 }));

    await expect(
      runtime().handlePollMusicStatus('minimax/music-3/requests/req-5'),
    ).resolves.toMatchObject({
      errorType: AgentRuntimeErrorType.ProviderBizError,
      status: 'failed',
    });
  });

  it('throws InvalidProviderAPIKey when the queue rejects the key on submit', async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: 'invalid key credentials' }, 401));

    await expect(
      runtime().createMusic({ model: 'fal-ai/ace-step-1.5', params: { prompt: 'pop' } }),
    ).rejects.toMatchObject({
      error: { message: 'invalid key credentials', status: 401 },
      errorType: AgentRuntimeErrorType.InvalidProviderAPIKey,
      provider: 'fal',
    });
  });

  it('throws InsufficientQuota when fal locks the account for an exhausted balance', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ detail: 'User is locked. Reason: Exhausted balance. Top up your balance.' }, 403),
    );

    await expect(
      runtime().createMusic({ model: 'fal-ai/minimax-music/v2.6', params: { prompt: 'pop song' } }),
    ).rejects.toMatchObject({ errorType: AgentRuntimeErrorType.InsufficientQuota });
  });

  it('fails a running task once the key is rejected instead of polling forever', async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: 'invalid key credentials' }, 401));

    await expect(
      runtime().handlePollMusicStatus('fal-ai/ace-step-1.5/requests/req-6'),
    ).resolves.toEqual({
      error: 'invalid key credentials',
      errorType: AgentRuntimeErrorType.InvalidProviderAPIKey,
      status: 'failed',
    });
  });

  it('throws a transient status failure so the caller retries the poll', async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: 'upstream busy' }, 503));

    await expect(
      runtime().handlePollMusicStatus('fal-ai/ace-step-1.5/requests/req-7'),
    ).rejects.toMatchObject({ errorType: AgentRuntimeErrorType.ProviderServiceUnavailable });
  });

  it('maps a dropped connection to ProviderNetworkError', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(
      runtime().createMusic({ model: 'fal-ai/ace-step-1.5', params: { prompt: 'pop' } }),
    ).rejects.toMatchObject({ errorType: AgentRuntimeErrorType.ProviderNetworkError });
  });

  it('polls until completion when asked to wait', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ request_id: 'req-8' }))
      .mockResolvedValueOnce(json({ status: 'IN_QUEUE' }))
      .mockResolvedValueOnce(json({ status: 'IN_PROGRESS' }))
      .mockResolvedValueOnce(json({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(
        json({
          audio: { content_type: 'audio/wav', url: 'https://fal.media/o.wav' },
          duration: 42,
        }),
      );

    await expect(
      runtime().createMusic(
        { model: 'minimax/music-3', params: { lyrics: 'la', prompt: 'pop' } },
        { pollIntervalMs: 1, waitForCompletion: true },
      ),
    ).resolves.toEqual({
      inferenceId: 'minimax/music-3/requests/req-8',
      status: 'success',
      tracks: [{ audioUrl: 'https://fal.media/o.wav', contentType: 'audio/wav', duration: 42 }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('times out a task that never completes within the poll budget', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ request_id: 'req-9' }))
      .mockImplementation(async () => json({ status: 'IN_PROGRESS' }));

    await expect(
      runtime().createMusic(
        { model: 'fal-ai/ace-step-1.5', params: { prompt: 'pop' } },
        { maxAttempts: 3, pollIntervalMs: 1, waitForCompletion: true },
      ),
    ).rejects.toMatchObject({
      error: { maxAttempts: 3, taskId: 'fal-ai/ace-step-1.5/requests/req-9' },
      errorType: AgentRuntimeErrorType.ProviderNetworkError,
    });
    // One submit plus three status queries
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('fails the wait when the task fails', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ request_id: 'req-10' }))
      .mockResolvedValueOnce(json({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(json({ detail: 'GPU crashed' }, 500));

    await expect(
      runtime().createMusic(
        { model: 'fal-ai/ace-step-1.5', params: { prompt: 'pop' } },
        { pollIntervalMs: 1, waitForCompletion: true },
      ),
    ).rejects.toMatchObject({
      error: { message: 'GPU crashed' },
      errorType: AgentRuntimeErrorType.ProviderServiceUnavailable,
    });
  });

  describe('checkCredentials', () => {
    it('accepts a key the platform API accepts', async () => {
      fetchMock.mockResolvedValueOnce(json({ models: [] }));

      await expect(runtime().checkCredentials()).resolves.toEqual({});
      expect(requestOf(0).url).toBe('https://api.fal.ai/v1/models?limit=1');
      expect(requestOf(0).headers.Authorization).toBe('Key test-key');
    });

    it('rejects an invalid key', async () => {
      fetchMock.mockResolvedValueOnce(json({ detail: 'invalid key credentials' }, 401));

      await expect(runtime().checkCredentials()).rejects.toMatchObject({
        errorType: AgentRuntimeErrorType.InvalidProviderAPIKey,
      });
    });
  });
});
