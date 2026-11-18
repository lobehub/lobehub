import { resolveBusinessModelMapping } from '@lobechat/business-model-runtime';
import { AsyncTaskErrorType, AsyncTaskStatus } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { chargeAfterGenerate } from '@/business/server/music-generation/chargeAfterGenerate';
import { AsyncTaskModel } from '@/database/models/asyncTask';
import { GenerationModel } from '@/database/models/generation';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { GenerationService } from '@/server/services/generation';
import { MusicGenerationService } from '@/server/services/generation/music';
import { FileSource } from '@/types/files';

import {
  MUSIC_POLL_INTERVAL_MS,
  MUSIC_POLL_MAX_CONSECUTIVE_ERRORS,
  musicRouter,
  pollMusicUntilCompletion,
} from '../music';

vi.mock('@/database/models/asyncTask', () => ({ AsyncTaskModel: vi.fn() }));
vi.mock('@/database/models/generation', () => ({ GenerationModel: vi.fn() }));
vi.mock('@/server/services/generation', () => ({ GenerationService: vi.fn() }));
vi.mock('@/server/services/generation/music', () => ({ MusicGenerationService: vi.fn() }));
vi.mock('@/server/modules/ModelRuntime', () => ({ initModelRuntimeFromDB: vi.fn() }));
vi.mock('@/envs/app', () => ({
  appEnv: { APP_URL: 'https://app.example.com', WEBHOOK_PROXY_URL: undefined },
}));
vi.mock('@/business/server/getProviderContentPolicyErrorMessage', () => ({
  getProviderContentPolicyErrorMessage: vi.fn(async () => undefined),
}));
vi.mock('@/business/server/music-generation/chargeAfterGenerate', () => ({
  chargeAfterGenerate: vi.fn(),
}));
vi.mock('@lobechat/business-const', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  ENABLE_BUSINESS_FEATURES: true,
}));
vi.mock('@lobechat/business-model-runtime', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  buildMappedBusinessModelFields: vi.fn(() => ({})),
  resolveBusinessModelMapping: vi.fn(),
}));
vi.mock('@/libs/trpc/async', async () => {
  const { asyncTrpc } = await vi.importActual<{ asyncTrpc: any }>('@/libs/trpc/async/init');
  return {
    asyncAuthedProcedure: asyncTrpc.procedure,
    asyncRouter: asyncTrpc.router,
    createAsyncCallerFactory: asyncTrpc.createCallerFactory,
    publicProcedure: asyncTrpc.procedure,
  };
});

const userId = 'user_test';
const tasks = [
  { asyncTaskId: 'task-1', generationId: 'gen-1' },
  { asyncTaskId: 'task-2', generationId: 'gen-2' },
];

const createInput = (overrides: Record<string, unknown> = {}) => ({
  asyncTaskCreatedAt: new Date(Date.now() - 1000),
  generationBatchId: 'batch-1',
  generationTopicId: 'topic-1',
  model: 'song-model',
  params: { lyrics: '[Verse]\nhello', prompt: 'lo-fi rain', title: 'Rain' },
  prechargeResult: { reservationKey: 'brk-1' },
  provider: 'fal',
  tasks,
  webhookToken: 'token-1',
  ...overrides,
});

const processResult = (n: number) => ({
  audioKey: `generations/music/song${n}.mp3`,
  coverKey: `generations/music/song${n}_cover.jpg`,
  duration: 120 + n,
  fileHash: `hash-${n}`,
  fileSize: 1000 + n,
  mimeType: 'audio/mpeg',
});

describe('musicRouter.createMusic', () => {
  let asyncTaskModelMock: { update: ReturnType<typeof vi.fn> };
  let generationModelMock: { createAssetAndFile: ReturnType<typeof vi.fn> };
  let musicServiceMock: { processTrack: ReturnType<typeof vi.fn> };
  let generationServiceMock: { ensureTopicCover: ReturnType<typeof vi.fn> };
  let runtime: {
    createMusic: ReturnType<typeof vi.fn>;
    handlePollMusicStatus: ReturnType<typeof vi.fn>;
  };
  let ctx: any;

  const taskUpdates = (taskId: string) =>
    asyncTaskModelMock.update.mock.calls.filter(([id]) => id === taskId).map(([, value]) => value);

  beforeEach(() => {
    vi.clearAllMocks();
    asyncTaskModelMock = { update: vi.fn() };
    generationModelMock = { createAssetAndFile: vi.fn() };
    let n = 0;
    musicServiceMock = { processTrack: vi.fn(async () => processResult(++n)) };
    generationServiceMock = { ensureTopicCover: vi.fn() };
    runtime = { createMusic: vi.fn(), handlePollMusicStatus: vi.fn() };

    vi.mocked(AsyncTaskModel).mockImplementation(function () {
      return asyncTaskModelMock as any;
    });
    vi.mocked(GenerationModel).mockImplementation(function () {
      return generationModelMock as any;
    });
    vi.mocked(MusicGenerationService).mockImplementation(function () {
      return musicServiceMock as any;
    });
    vi.mocked(GenerationService).mockImplementation(function () {
      return generationServiceMock as any;
    });
    vi.mocked(initModelRuntimeFromDB).mockResolvedValue(runtime as any);
    vi.mocked(resolveBusinessModelMapping).mockImplementation(async (_provider, model) => ({
      resolvedModelId: model,
    }));

    ctx = {
      serverDB: {
        query: {
          generationBatches: {
            findFirst: vi.fn().mockResolvedValue({ id: 'batch-1', prompt: 'lo-fi rain' }),
          },
        },
      },
      userId,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores a synchronous provider result and charges per stored song', async () => {
    runtime.createMusic.mockResolvedValue({
      inferenceId: 'trace-1',
      status: 'success',
      tracks: [{ audio: new ArrayBuffer(8), contentType: 'audio/mpeg', duration: 30 }],
    });

    const result = await musicRouter
      .createCaller(ctx)
      .createMusic(createInput({ model: 'song-model-lite', provider: 'acme', tasks: [tasks[0]] }));

    expect(result).toEqual({ stored: 1, success: true });
    expect(runtime.createMusic).toHaveBeenCalledWith(
      {
        model: 'song-model-lite',
        params: { lyrics: '[Verse]\nhello', prompt: 'lo-fi rain', title: 'Rain' },
      },
      expect.objectContaining({
        callbackUrl: 'https://app.example.com/api/webhooks/music/acme?token=token-1',
        // The LobeHub router records the request source on the route attempt
        metadata: { trigger: 'music' },
      }),
    );
    expect(runtime.handlePollMusicStatus).not.toHaveBeenCalled();
    expect(generationModelMock.createAssetAndFile).toHaveBeenCalledWith(
      'gen-1',
      expect.objectContaining({
        coverUrl: 'generations/music/song1_cover.jpg',
        duration: 121,
        mimeType: 'audio/mpeg',
        title: 'Rain',
        type: 'audio',
        url: 'generations/music/song1.mp3',
      }),
      expect.objectContaining({
        fileHash: 'hash-1',
        fileType: 'audio/mpeg',
        name: 'Rain.mp3',
        url: 'generations/music/song1.mp3',
      }),
      FileSource.MusicGeneration,
    );
    expect(taskUpdates('task-1')).toEqual([
      { status: AsyncTaskStatus.Processing },
      { inferenceId: 'trace-1' },
      expect.objectContaining({ status: AsyncTaskStatus.Success }),
    ]);
    expect(generationServiceMock.ensureTopicCover).toHaveBeenCalledWith(
      'topic-1',
      'generations/music/song1_cover.jpg',
    );
    expect(chargeAfterGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        computePriceParams: { duration: 121, songs: 1 },
        model: 'song-model-lite',
      }),
    );
  });

  it('polls an asynchronous provider until it completes, then stores every track', async () => {
    vi.useFakeTimers();
    runtime.createMusic.mockResolvedValue({
      inferenceId: 'music-task-1',
      route: { model: 'song-model' },
      status: 'pending',
    });
    runtime.handlePollMusicStatus
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValueOnce({
        status: 'success',
        tracks: [
          { audioUrl: 'https://cdn.example.com/a.mp3', id: 'clip-a', title: 'Rain A' },
          { audioUrl: 'https://cdn.example.com/b.mp3', id: 'clip-b', title: 'Rain B' },
        ],
      });

    const promise = musicRouter.createCaller(ctx).createMusic(createInput());
    await vi.advanceTimersByTimeAsync(MUSIC_POLL_INTERVAL_MS);
    const result = await promise;

    expect(result).toEqual({ stored: 2, success: true });
    expect(runtime.handlePollMusicStatus).toHaveBeenCalledTimes(2);
    expect(runtime.handlePollMusicStatus).toHaveBeenCalledWith(
      'music-task-1',
      'song-model',
      { model: 'song-model' },
      { signal: expect.any(AbortSignal) },
    );
    // The pending task id and polling route are recorded before polling starts
    expect(taskUpdates('task-2')[1]).toEqual({
      inferenceId: 'music-task-1',
      metadata: expect.objectContaining({ index: 1, route: { model: 'song-model' } }),
    });
    expect(generationModelMock.createAssetAndFile).toHaveBeenCalledTimes(2);
    expect(generationModelMock.createAssetAndFile.mock.calls[1][1]).toMatchObject({
      originalUrl: 'https://cdn.example.com/b.mp3',
      providerTrackId: 'clip-b',
      title: 'Rain B',
      url: 'generations/music/song2.mp3',
    });
    for (const id of ['task-1', 'task-2'])
      expect(taskUpdates(id).at(-1)).toMatchObject({ status: AsyncTaskStatus.Success });
    expect(chargeAfterGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ computePriceParams: { duration: 243, songs: 2 } }),
    );
  });

  it('stores two songs of one batch at the same time', async () => {
    runtime.createMusic.mockResolvedValue({
      status: 'success',
      tracks: [
        { audioUrl: 'https://cdn.example.com/a.mp3', id: 'clip-a' },
        { audioUrl: 'https://cdn.example.com/b.mp3', id: 'clip-b' },
      ],
    });
    const releases: (() => void)[] = [];
    let n = 0;
    musicServiceMock.processTrack.mockImplementation(
      () =>
        new Promise((resolve) => {
          const result = processResult(++n);
          releases.push(() => resolve(result));
        }),
    );

    const promise = musicRouter.createCaller(ctx).createMusic(createInput());
    await vi.waitFor(() => expect(musicServiceMock.processTrack).toHaveBeenCalledTimes(2));
    // Both downloads started before either finished
    expect(releases).toHaveLength(2);
    releases.forEach((release) => release());

    await expect(promise).resolves.toEqual({ stored: 2, success: true });
    expect(generationServiceMock.ensureTopicCover).toHaveBeenCalledTimes(1);
  });

  it('keeps a stored song successful when its first success status write fails', async () => {
    runtime.createMusic.mockResolvedValue({
      status: 'success',
      tracks: [
        { audioUrl: 'https://cdn.example.com/a.mp3', id: 'clip-a' },
        { audioUrl: 'https://cdn.example.com/b.mp3', id: 'clip-b' },
      ],
    });
    let failedOnce = false;
    asyncTaskModelMock.update.mockImplementation(async (id: string, value: any) => {
      if (id === 'task-1' && value.status === AsyncTaskStatus.Success && !failedOnce) {
        failedOnce = true;
        throw new Error('connection reset');
      }
    });

    const result = await musicRouter.createCaller(ctx).createMusic(createInput());

    expect(result).toEqual({ stored: 2, success: true });
    expect(taskUpdates('task-1').map((value) => value.status)).not.toContain(AsyncTaskStatus.Error);
    expect(taskUpdates('task-1').at(-1)).toMatchObject({ status: AsyncTaskStatus.Success });
  });

  it('fails every task and refunds when the provider reports the task failed', async () => {
    runtime.createMusic.mockResolvedValue({ inferenceId: 'music-task-2', status: 'pending' });
    runtime.handlePollMusicStatus.mockResolvedValue({
      error: 'Lyrics contain sensitive words',
      errorType: 'ContentModeration',
      status: 'failed',
    });

    const result = await musicRouter.createCaller(ctx).createMusic(createInput());

    expect(result).toEqual({
      message: 'Lyrics contain sensitive words',
      stored: 0,
      success: false,
    });
    for (const id of ['task-1', 'task-2'])
      expect(taskUpdates(id).at(-1)).toEqual({
        error: {
          body: { detail: 'Lyrics contain sensitive words' },
          name: AsyncTaskErrorType.ProviderContentModeration,
        },
        status: AsyncTaskStatus.Error,
      });
    expect(generationModelMock.createAssetAndFile).not.toHaveBeenCalled();
    expect(chargeAfterGenerate).toHaveBeenCalledWith(expect.objectContaining({ isError: true }));
  });

  it('maps a rejected submission with a bad key to InvalidProviderAPIKey', async () => {
    runtime.createMusic.mockRejectedValue({
      error: { message: 'Unauthorized' },
      errorType: 'InvalidProviderAPIKey',
    });

    const result = await musicRouter.createCaller(ctx).createMusic(createInput());

    expect(result.success).toBe(false);
    expect(taskUpdates('task-1').at(-1)).toEqual({
      error: { body: { detail: 'Unauthorized' }, name: AsyncTaskErrorType.InvalidProviderAPIKey },
      status: AsyncTaskStatus.Error,
    });
    expect(runtime.handlePollMusicStatus).not.toHaveBeenCalled();
  });

  it('reports other submission failures as a trigger error', async () => {
    runtime.createMusic.mockRejectedValue(new Error('socket hang up'));

    await musicRouter.createCaller(ctx).createMusic(createInput());

    expect(taskUpdates('task-1').at(-1)).toEqual({
      error: {
        body: { detail: 'Failed to submit music task: socket hang up' },
        name: AsyncTaskErrorType.TaskTriggerError,
      },
      status: AsyncTaskStatus.Error,
    });
  });

  it('fails only the generations the provider returned no track for', async () => {
    runtime.createMusic.mockResolvedValue({
      status: 'success',
      tracks: [{ audioUrl: 'https://cdn.example.com/only.mp3' }],
    });

    const result = await musicRouter.createCaller(ctx).createMusic(createInput());

    expect(result).toEqual({ stored: 1, success: true });
    expect(taskUpdates('task-1').at(-1)).toMatchObject({ status: AsyncTaskStatus.Success });
    expect(taskUpdates('task-2').at(-1)).toEqual({
      error: {
        body: { detail: 'Music generation failed: The provider returned 1 of 2 songs' },
        name: AsyncTaskErrorType.ServerError,
      },
      status: AsyncTaskStatus.Error,
    });
    expect(chargeAfterGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ computePriceParams: { duration: 121, songs: 1 } }),
    );
  });

  it('retries the error of a song without a track when its first error write fails', async () => {
    runtime.createMusic.mockResolvedValue({
      status: 'success',
      tracks: [{ audioUrl: 'https://cdn.example.com/only.mp3' }],
    });
    let failedOnce = false;
    asyncTaskModelMock.update.mockImplementation(async (id: string, value: any) => {
      if (id === 'task-2' && value.status === AsyncTaskStatus.Error && !failedOnce) {
        failedOnce = true;
        throw new Error('connection reset');
      }
    });

    await musicRouter.createCaller(ctx).createMusic(createInput());

    // The batch failure path writes the error again instead of leaving the task processing
    const errors = taskUpdates('task-2').filter((value) => value.status === AsyncTaskStatus.Error);
    expect(errors).toHaveLength(2);
  });

  it('fails a song whose download fails without failing the others', async () => {
    runtime.createMusic.mockResolvedValue({
      status: 'success',
      tracks: [{ audioUrl: 'https://cdn.example.com/a.mp3' }, { audioUrl: 'https://x/b.mp3' }],
    });
    musicServiceMock.processTrack
      .mockResolvedValueOnce(processResult(1))
      .mockRejectedValueOnce(new Error('Failed to download https://x/b.mp3: 403 Forbidden'));

    const result = await musicRouter.createCaller(ctx).createMusic(createInput());

    expect(result).toEqual({ stored: 1, success: true });
    expect(taskUpdates('task-2').at(-1)).toMatchObject({
      error: { name: AsyncTaskErrorType.ServerError },
      status: AsyncTaskStatus.Error,
    });
  });

  it('keeps stored songs when setting the topic cover fails', async () => {
    runtime.createMusic.mockResolvedValue({
      status: 'success',
      tracks: [{ audioUrl: 'https://cdn.example.com/a.mp3' }, { audioUrl: 'https://x/b.mp3' }],
    });
    generationServiceMock.ensureTopicCover.mockRejectedValue(new Error('sharp failed'));

    const result = await musicRouter.createCaller(ctx).createMusic(createInput());

    expect(result).toEqual({ stored: 2, success: true });
    for (const id of ['task-1', 'task-2'])
      expect(taskUpdates(id).at(-1)).toMatchObject({ status: AsyncTaskStatus.Success });
    expect(chargeAfterGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ computePriceParams: { duration: 243, songs: 2 } }),
    );
  });

  it('does not overwrite or refund an already stored song when the batch fails later', async () => {
    runtime.createMusic.mockResolvedValue({
      status: 'success',
      tracks: [{ audioUrl: 'https://cdn.example.com/a.mp3' }],
    });
    // Recording the missing second song fails (e.g. the database drops the connection)
    asyncTaskModelMock.update.mockImplementation(async (id: string, value: any) => {
      if (id === 'task-2' && value.error?.body?.detail?.includes('1 of 2'))
        throw new Error('connection reset');
    });

    const result = await musicRouter.createCaller(ctx).createMusic(createInput());

    expect(result).toMatchObject({ stored: 1, success: true });
    expect(taskUpdates('task-1').at(-1)).toMatchObject({ status: AsyncTaskStatus.Success });
    expect(taskUpdates('task-1')).not.toContainEqual(
      expect.objectContaining({ status: AsyncTaskStatus.Error }),
    );
    expect(taskUpdates('task-2').at(-1)).toMatchObject({ status: AsyncTaskStatus.Error });
    expect(chargeAfterGenerate).toHaveBeenCalledTimes(1);
    expect(chargeAfterGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ computePriceParams: { duration: 121, songs: 1 } }),
    );
  });

  it('fails when the provider runtime has no music support', async () => {
    runtime.createMusic.mockResolvedValue(undefined);

    const result = await musicRouter
      .createCaller(ctx)
      .createMusic(createInput({ provider: 'openai' }));

    expect(result).toMatchObject({
      message: 'Failed to submit music task: Provider "openai" does not support music generation',
      success: false,
    });
  });

  it('rejects params the music schema does not know', async () => {
    await expect(
      musicRouter
        .createCaller(ctx)
        .createMusic(createInput({ params: { lyric: 'typo', prompt: 'x' } })),
    ).rejects.toThrow(/Unrecognized key/);
    expect(runtime.createMusic).not.toHaveBeenCalled();
  });
});

describe('pollMusicUntilCompletion', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries a thrown status query and keeps polling', async () => {
    vi.useFakeTimers();
    const handlePollMusicStatus = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce({ status: 'success', tracks: [{ audioUrl: 'https://x/a.mp3' }] });

    const promise = pollMusicUntilCompletion({ handlePollMusicStatus } as any, {
      inferenceId: 'inf',
      model: 'song-model',
      signal: new AbortController().signal,
    });
    await vi.advanceTimersByTimeAsync(MUSIC_POLL_INTERVAL_MS);

    await expect(promise).resolves.toEqual([{ audioUrl: 'https://x/a.mp3' }]);
    expect(handlePollMusicStatus).toHaveBeenCalledTimes(2);
  });

  // A stalled status request must be interrupted by the task deadline, not only the delay
  // between polls, so the failure path can still settle task state and billing.
  it('passes the task signal into every status request', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const handlePollMusicStatus = vi
      .fn()
      .mockResolvedValue({ status: 'success', tracks: [{ audioUrl: 'https://x/a.mp3' }] });

    await pollMusicUntilCompletion({ handlePollMusicStatus } as any, {
      inferenceId: 'inf',
      model: 'song-model',
      route: { channelId: 'a' },
      signal: controller.signal,
    });

    expect(handlePollMusicStatus).toHaveBeenCalledWith(
      'inf',
      'song-model',
      { channelId: 'a' },
      { signal: controller.signal },
    );
  });

  it('fails after repeated thrown status queries instead of idling until the timeout', async () => {
    vi.useFakeTimers();
    const error = { error: { message: 'Unauthorized' }, errorType: 'InvalidProviderAPIKey' };
    const handlePollMusicStatus = vi.fn().mockRejectedValue(error);

    const promise = pollMusicUntilCompletion({ handlePollMusicStatus } as any, {
      inferenceId: 'inf',
      model: 'song-model',
      signal: new AbortController().signal,
    });
    const assertion = expect(promise).rejects.toBe(error);
    await vi.advanceTimersByTimeAsync(MUSIC_POLL_INTERVAL_MS * MUSIC_POLL_MAX_CONSECUTIVE_ERRORS);
    await assertion;
    expect(handlePollMusicStatus).toHaveBeenCalledTimes(MUSIC_POLL_MAX_CONSECUTIVE_ERRORS);
  });

  it('stops with an AbortError when the task timeout fires', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const handlePollMusicStatus = vi.fn().mockResolvedValue({ status: 'pending' });

    const promise = pollMusicUntilCompletion({ handlePollMusicStatus } as any, {
      inferenceId: 'inf',
      model: 'song-model',
      signal: controller.signal,
    });
    const assertion = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(MUSIC_POLL_INTERVAL_MS);
    controller.abort();
    await assertion;
  });

  it('fails fast when the runtime cannot poll', async () => {
    const handlePollMusicStatus = vi.fn().mockResolvedValue(undefined);

    await expect(
      pollMusicUntilCompletion({ handlePollMusicStatus } as any, {
        inferenceId: 'inf',
        model: 'x',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('This provider cannot poll music tasks');
  });
});
