// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { ChunkModel } from '@/database/models/chunk';
import { EmbeddingModel } from '@/database/models/embedding';
import { FileModel } from '@/database/models/file';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { AsyncTaskErrorType, AsyncTaskStatus } from '@/types/asyncTask';

import { fileRouter } from '../file';

vi.mock('@lobechat/business-config/server', () => ({ ASYNC_TASK_TIMEOUT: 20 }));
vi.mock('@/envs/file', () => ({ fileEnv: { EMBEDDING_BATCH_SIZE: 1, EMBEDDING_CONCURRENCY: 2 } }));
vi.mock('@/database/models/asyncTask', () => ({ AsyncTaskModel: vi.fn() }));
vi.mock('@/database/models/chunk', () => ({ ChunkModel: vi.fn() }));
vi.mock('@/database/models/embedding', () => ({ EmbeddingModel: vi.fn() }));
vi.mock('@/database/models/file', () => ({ FileModel: vi.fn() }));
vi.mock('@/server/services/chunk', () => ({ ChunkService: vi.fn() }));
vi.mock('@/server/services/document', () => ({ DocumentService: vi.fn() }));
vi.mock('@/server/services/file', () => ({ FileService: vi.fn() }));
vi.mock('@/server/modules/ModelRuntime', () => ({ initModelRuntimeFromDB: vi.fn() }));
vi.mock('@/business/server/trpc-middlewares/async', () => ({
  checkEmbeddingUsage: async (opts: any) => opts.next({ ctx: opts.ctx }),
}));

vi.mock('@/libs/trpc/async', async () => {
  const init = await vi.importActual<{ asyncTrpc: any }>('@/libs/trpc/async/init');
  const { asyncTrpc } = init;
  return {
    asyncAuthedProcedure: asyncTrpc.procedure,
    asyncRouter: asyncTrpc.router,
    createAsyncCallerFactory: asyncTrpc.createCallerFactory,
    publicProcedure: asyncTrpc.procedure,
  };
});

describe('fileRouter.embeddingChunks timeout', () => {
  const asyncTaskModelMock = { findById: vi.fn(), update: vi.fn() };
  const embeddingModelMock = { bulkCreate: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();

    asyncTaskModelMock.findById.mockResolvedValue({ id: 'task-1' });
    vi.mocked(AsyncTaskModel).mockImplementation(function () {
      return asyncTaskModelMock as any;
    });
    vi.mocked(FileModel).mockImplementation(function () {
      return { findById: vi.fn().mockResolvedValue({ id: 'file-1', name: 'a.csv' }) } as any;
    });
    vi.mocked(ChunkModel).mockImplementation(function () {
      return {
        getChunksTextByFileId: vi.fn().mockResolvedValue([{ id: 'chunk-1', text: 'row' }]),
      } as any;
    });
    vi.mocked(EmbeddingModel).mockImplementation(function () {
      return embeddingModelMock as any;
    });
    Reflect.set(FileModel, 'getFileById', undefined);
  });

  const deferred = () => {
    let resolve!: (value: number[][]) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<number[][]>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, reject, resolve };
  };
  const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const errorUpdates = () =>
    asyncTaskModelMock.update.mock.calls.filter(
      ([, value]) => value.status === AsyncTaskStatus.Error,
    );

  it('holds the task until a late batch settles after a timeout, and does not write it', async () => {
    const late = deferred();
    vi.mocked(initModelRuntimeFromDB).mockResolvedValue({
      embeddings: vi.fn(() => late.promise),
    } as any);

    const caller = fileRouter.createCaller({ serverDB: {}, userId: 'user-1' } as any);
    const run = caller.embeddingChunks({ fileId: 'file-1', taskId: 'task-1' });

    await tick(60);
    // Timed out, but a batch is still in flight: the task must not be released yet.
    expect(errorUpdates()).toHaveLength(0);

    late.resolve([[0.1]]);
    await expect(run).resolves.toMatchObject({ success: false });

    expect(embeddingModelMock.bulkCreate).not.toHaveBeenCalled();
    expect(errorUpdates()).toEqual([
      [
        'task-1',
        expect.objectContaining({
          error: expect.objectContaining({ name: AsyncTaskErrorType.Timeout }),
        }),
      ],
    ]);
  });

  it('stops sibling batches from writing after one batch fails', async () => {
    vi.mocked(ChunkModel).mockImplementation(function () {
      return {
        getChunksTextByFileId: vi.fn().mockResolvedValue([
          { id: 'chunk-1', text: 'row 1' },
          { id: 'chunk-2', text: 'row 2' },
        ]),
      } as any;
    });
    const failing = deferred();
    const sibling = deferred();
    vi.mocked(initModelRuntimeFromDB).mockResolvedValue({
      embeddings: vi.fn().mockReturnValueOnce(failing.promise).mockReturnValueOnce(sibling.promise),
    } as any);

    const caller = fileRouter.createCaller({ serverDB: {}, userId: 'user-1' } as any);
    const run = caller.embeddingChunks({ fileId: 'file-1', taskId: 'task-1' });

    await tick(5);
    failing.reject(new Error('provider error'));
    await tick(5);
    expect(errorUpdates()).toHaveLength(0);

    sibling.resolve([[0.2]]);
    await expect(run).resolves.toMatchObject({ success: false });

    expect(embeddingModelMock.bulkCreate).not.toHaveBeenCalled();
    expect(errorUpdates()).toHaveLength(1);
  });
});
