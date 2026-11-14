import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chargeAfterGenerate } from '@/business/server/music-generation/chargeAfterGenerate';
import { chargeBeforeGenerate } from '@/business/server/music-generation/chargeBeforeGenerate';
import { AsyncTaskModel } from '@/database/models/asyncTask';
import { FileService } from '@/server/services/file';
import { AsyncTaskErrorType, AsyncTaskStatus, AsyncTaskType } from '@/types/asyncTask';

const {
  mockAsyncCreateMusic,
  mockCreateAsyncCaller,
  mockGenerationTopicFindById,
  mockResolveMusicModelCard,
  mockServerDB,
  mockTransaction,
} = vi.hoisted(() => {
  const mockTransaction = vi.fn();
  return {
    mockAsyncCreateMusic: vi.fn(),
    mockCreateAsyncCaller: vi.fn(),
    mockGenerationTopicFindById: vi.fn(),
    mockResolveMusicModelCard: vi.fn(),
    mockServerDB: { transaction: mockTransaction },
    mockTransaction,
  };
});

vi.mock('@/database/models/asyncTask');
vi.mock('@/database/models/generationTopic', () => ({
  GenerationTopicModel: vi.fn(function () {
    return { findById: mockGenerationTopicFindById };
  }),
}));
vi.mock('@/server/services/file');
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn().mockResolvedValue(mockServerDB),
}));
vi.mock('@/database/server', () => ({
  getServerDB: vi.fn().mockResolvedValue(mockServerDB),
}));
vi.mock('@/server/routers/async/caller', () => ({
  createAsyncCaller: mockCreateAsyncCaller,
}));
vi.mock('@/server/services/generation/musicModel', () => ({
  resolveMusicModelCard: mockResolveMusicModelCard,
}));
vi.mock('@/business/server/music-generation/chargeBeforeGenerate', () => ({
  chargeBeforeGenerate: vi.fn(),
}));
vi.mock('@/business/server/music-generation/chargeAfterGenerate', () => ({
  chargeAfterGenerate: vi.fn(),
}));
vi.mock('@lobechat/business-model-runtime', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  resolveBusinessModelMapping: vi.fn(async (_provider: string, model: string) => ({
    resolvedModelId: model,
  })),
}));
vi.mock('debug', () => ({
  default: vi.fn(function () {
    return vi.fn();
  }),
}));

const { musicRouter } = await import('../music');

const songCard = {
  outputsPerRequest: 2,
  parameters: {
    instrumental: { default: false },
    lyrics: { default: null, maxLength: 20 },
    prompt: { default: '' },
    style: { default: null },
    title: { default: null },
  },
  type: 'text2music',
};

const defaultInput = {
  generationTopicId: 'topic-1',
  model: 'song-model',
  params: { lyrics: '[Verse] hi', prompt: 'lo-fi rain', style: 'lo-fi' },
  provider: 'fal',
};

/** Drizzle-like tx whose inserts return the rows they were given, with ids */
const setupTransaction = () => {
  const inserted: Record<string, any[]> = { asyncTasks: [], batches: [], generations: [] };
  let taskSeq = 0;
  const insert = vi.fn((table: any) => ({
    values: (values: any) => ({
      returning: async () => {
        const rows = Array.isArray(values) ? values : [values];
        if ('generationTopicId' in rows[0] && 'prompt' in rows[0]) {
          inserted.batches.push(...rows);
          return [{ ...rows[0], id: 'batch-1' }];
        }
        if ('generationBatchId' in rows[0]) {
          inserted.generations.push(...rows);
          return rows.map((row: any, i: number) => ({ ...row, id: `gen-${i + 1}` }));
        }
        inserted.asyncTasks.push(...rows);
        taskSeq += 1;
        return [{ ...rows[0], createdAt: new Date('2026-11-13'), id: `task-${taskSeq}` }];
      },
    }),
    table,
  }));
  const update = vi.fn(() => ({ set: () => ({ where: async () => undefined }) }));
  mockTransaction.mockImplementation(async (cb: any) => cb({ insert, update }));
  return inserted;
};

describe('musicRouter.createMusic (lambda)', () => {
  const ctx = { userId: 'test-user' };
  let asyncTaskUpdate: ReturnType<typeof vi.fn>;
  let fileService: {
    getFullFileUrl: ReturnType<typeof vi.fn>;
    getKeyFromFullUrl: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    asyncTaskUpdate = vi.fn();
    fileService = { getFullFileUrl: vi.fn(), getKeyFromFullUrl: vi.fn().mockResolvedValue(null) };
    vi.mocked(AsyncTaskModel).mockImplementation(function () {
      return { update: asyncTaskUpdate } as any;
    });
    vi.mocked(FileService).mockImplementation(function () {
      return fileService as any;
    });
    vi.mocked(chargeBeforeGenerate).mockResolvedValue({});
    mockResolveMusicModelCard.mockResolvedValue(songCard);
    mockGenerationTopicFindById.mockResolvedValue({ id: 'topic-1', type: 'music' });
    mockAsyncCreateMusic.mockResolvedValue({ stored: 2, success: true });
    mockCreateAsyncCaller.mockResolvedValue({ music: { createMusic: mockAsyncCreateMusic } });
  });

  it('creates one generation and pending task per song and hands the batch to the async router', async () => {
    const inserted = setupTransaction();

    const result = await musicRouter.createCaller(ctx as any).createMusic(defaultInput);

    expect(result.success).toBe(true);
    expect(result.data.batch).toMatchObject({
      config: defaultInput.params,
      id: 'batch-1',
      model: 'song-model',
      prompt: 'lo-fi rain',
      provider: 'fal',
    });
    expect(result.data.generations).toEqual([
      expect.objectContaining({ asyncTaskId: 'task-1', id: 'gen-1' }),
      expect.objectContaining({ asyncTaskId: 'task-2', id: 'gen-2' }),
    ]);
    expect(inserted.generations).toHaveLength(2);
    expect(inserted.asyncTasks).toEqual([
      expect.objectContaining({
        metadata: { index: 0, webhookToken: expect.stringMatching(/^[\da-f]{64}$/) },
        status: AsyncTaskStatus.Pending,
        type: AsyncTaskType.MusicGeneration,
      }),
      expect.objectContaining({ metadata: expect.objectContaining({ index: 1 }) }),
    ]);
    expect(chargeBeforeGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'song-model', provider: 'fal', songCount: 2 }),
    );
    expect(mockAsyncCreateMusic).toHaveBeenCalledWith(
      expect.objectContaining({
        generationBatchId: 'batch-1',
        generationTopicId: 'topic-1',
        model: 'song-model',
        params: defaultInput.params,
        provider: 'fal',
        tasks: [
          { asyncTaskId: 'task-1', generationId: 'gen-1' },
          { asyncTaskId: 'task-2', generationId: 'gen-2' },
        ],
        webhookToken: inserted.asyncTasks[0].metadata.webhookToken,
      }),
    );
  });

  it('stores an uploaded reference audio as its storage key', async () => {
    setupTransaction();
    mockResolveMusicModelCard.mockResolvedValue({
      outputsPerRequest: 1,
      parameters: { prompt: { default: '' }, referenceAudioUrl: { default: null, required: true } },
      type: 'text2music',
    });
    fileService.getKeyFromFullUrl.mockResolvedValue('files/user/ref.mp3');
    fileService.getFullFileUrl.mockResolvedValue('https://s3.example.com/files/user/ref.mp3');

    const result = await musicRouter.createCaller(ctx as any).createMusic({
      ...defaultInput,
      model: 'cover-model',
      params: {
        prompt: 'jazz cover',
        referenceAudioUrl: 'https://s3.example.com/files/user/ref.mp3',
      },
      provider: 'acme',
    });

    expect(result.data.batch.config).toMatchObject({ referenceAudioUrl: 'files/user/ref.mp3' });
    expect(mockAsyncCreateMusic).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          referenceAudioUrl: 'https://s3.example.com/files/user/ref.mp3',
        }),
      }),
    );
  });

  it('keeps a pasted third-party reference audio URL instead of rewriting it to a key', async () => {
    setupTransaction();
    mockResolveMusicModelCard.mockResolvedValue({
      outputsPerRequest: 1,
      parameters: { prompt: { default: '' }, referenceAudioUrl: { default: null, required: true } },
      type: 'text2music',
    });
    // getKeyFromFullUrl returns the pathname of any URL; the origin check must reject it
    fileService.getKeyFromFullUrl.mockResolvedValue('audio/ref.mp3');
    fileService.getFullFileUrl.mockResolvedValue('https://s3.example.com/audio/ref.mp3');

    const result = await musicRouter.createCaller(ctx as any).createMusic({
      ...defaultInput,
      model: 'cover-model',
      params: { prompt: 'jazz cover', referenceAudioUrl: 'https://cdn.other.com/audio/ref.mp3' },
      provider: 'acme',
    });

    expect(result.data.batch.config).toMatchObject({
      referenceAudioUrl: 'https://cdn.other.com/audio/ref.mp3',
    });
  });

  describe('validation', () => {
    it('rejects a model that is not a text2music model', async () => {
      mockResolveMusicModelCard.mockResolvedValue({ outputsPerRequest: 1, type: 'tts' });

      await expect(
        musicRouter.createCaller(ctx as any).createMusic({ ...defaultInput, model: 'speech-02' }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'Model "speech-02" is a tts model, not a music generation (text2music) model',
      });
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('rejects an unknown model', async () => {
      mockResolveMusicModelCard.mockResolvedValue(undefined);

      await expect(
        musicRouter.createCaller(ctx as any).createMusic({ ...defaultInput, model: 'nope' }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'Model "nope" is not available for provider "fal"',
      });
    });

    it('rejects params the model does not declare and lyrics over the model limit', async () => {
      await expect(
        musicRouter.createCaller(ctx as any).createMusic({
          ...defaultInput,
          params: {
            lyrics: 'x'.repeat(21),
            prompt: 'p',
            referenceAudioUrl: 'https://example.com/a.mp3',
          },
        }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message:
          'Invalid music params: The model does not support "referenceAudioUrl"; "lyrics" exceeds 20 characters',
      });
      expect(chargeBeforeGenerate).not.toHaveBeenCalled();
    });

    it('rejects a request without prompt, lyrics, style or reference audio', async () => {
      await expect(
        musicRouter
          .createCaller(ctx as any)
          .createMusic({ ...defaultInput, params: { prompt: '  ' } }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'Invalid music params: Provide a prompt, lyrics, style or reference audio',
      });
    });

    it('rejects unknown param keys at the input schema', async () => {
      await expect(
        musicRouter.createCaller(ctx as any).createMusic({
          ...defaultInput,
          params: { lyric: 'typo', prompt: 'p' } as any,
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(mockResolveMusicModelCard).not.toHaveBeenCalled();
    });

    it('rejects a topic that is not a music topic', async () => {
      mockGenerationTopicFindById.mockResolvedValue({ id: 'topic-1', type: 'video' });

      await expect(
        musicRouter.createCaller(ctx as any).createMusic(defaultInput),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'Music can only be generated in a music generation topic',
      });
    });

    it('rejects a topic the user cannot access', async () => {
      mockGenerationTopicFindById.mockResolvedValue(undefined);

      await expect(
        musicRouter.createCaller(ctx as any).createMusic(defaultInput),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  it('returns the error batch from the pre-charge without calling the provider', async () => {
    const errorBatch = {
      data: { batch: { id: 'batch-x' }, generations: [{ id: 'gen-x' }] },
      success: true as const,
    };
    vi.mocked(chargeBeforeGenerate).mockResolvedValue({ errorBatch } as any);

    const result = await musicRouter.createCaller(ctx as any).createMusic(defaultInput);

    expect(result).toBe(errorBatch);
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockCreateAsyncCaller).not.toHaveBeenCalled();
  });

  it('fails every task and refunds the pre-charge when the async router cannot be reached', async () => {
    setupTransaction();
    vi.mocked(chargeBeforeGenerate).mockResolvedValue({ prechargeResult: { key: 'brk-1' } });
    mockCreateAsyncCaller.mockRejectedValue(new Error('KEY_VAULTS_SECRET is not set'));

    const result = await musicRouter.createCaller(ctx as any).createMusic(defaultInput);

    expect(result.success).toBe(true);
    for (const taskId of ['task-1', 'task-2'])
      expect(asyncTaskUpdate).toHaveBeenCalledWith(taskId, {
        error: {
          body: { detail: 'Failed to submit music task: KEY_VAULTS_SECRET is not set' },
          name: AsyncTaskErrorType.TaskTriggerError,
        },
        status: AsyncTaskStatus.Error,
      });
    expect(chargeAfterGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ isError: true, prechargeResult: { key: 'brk-1' } }),
    );
  });
});
