// @vitest-environment node
import { ASYNC_TASK_TIMEOUT } from '@lobechat/business-config/server';
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { ChunkModel } from '@/database/models/chunk';
import { EmbeddingModel } from '@/database/models/embedding';
import { FileModel } from '@/database/models/file';
import { ChunkService } from '@/server/services/chunk';
import { DocumentService } from '@/server/services/document';
import { FileService } from '@/server/services/file';
import { AsyncTaskError, AsyncTaskErrorType, AsyncTaskStatus } from '@/types/asyncTask';

import { fileRouter } from '../file';

vi.mock('@/database/models/asyncTask', () => ({ AsyncTaskModel: vi.fn() }));
vi.mock('@/database/models/chunk', () => ({ ChunkModel: vi.fn() }));
vi.mock('@/database/models/embedding', () => ({ EmbeddingModel: vi.fn() }));
vi.mock('@/database/models/file', () => ({ FileModel: vi.fn() }));
vi.mock('@/server/services/chunk', () => ({ ChunkService: vi.fn() }));
vi.mock('@/server/services/document', () => ({ DocumentService: vi.fn() }));
vi.mock('@/server/services/file', () => ({ FileService: vi.fn() }));
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

describe('fileRouter.parseFileToChunks — NoSuchKey + internal:// branches', () => {
  const userId = 'user_test';
  let mockCtx: any;
  let asyncTaskModelMock: any;
  let fileModelMock: any;
  let fileServiceMock: any;
  let chunkServiceMock: any;
  let documentServiceMock: any;
  let chunkModelMock: any;

  beforeEach(() => {
    vi.clearAllMocks();

    asyncTaskModelMock = { findById: vi.fn(), update: vi.fn() };
    fileModelMock = { findById: vi.fn(), delete: vi.fn() };
    fileServiceMock = { getFileByteArray: vi.fn() };
    chunkServiceMock = {
      asyncEmbeddingFileChunks: vi.fn(),
      chunkContent: vi.fn(),
    };
    documentServiceMock = { parseFile: vi.fn() };
    chunkModelMock = { bulkCreate: vi.fn(), bulkCreateUnstructuredChunks: vi.fn() };

    vi.mocked(AsyncTaskModel).mockImplementation(function () {
      return asyncTaskModelMock;
    });
    vi.mocked(FileModel).mockImplementation(function () {
      return fileModelMock;
    });
    vi.mocked(FileService).mockImplementation(function () {
      return fileServiceMock;
    });
    vi.mocked(ChunkService).mockImplementation(function () {
      return chunkServiceMock;
    });
    vi.mocked(DocumentService).mockImplementation(function () {
      return documentServiceMock;
    });
    vi.mocked(ChunkModel).mockImplementation(function () {
      return chunkModelMock;
    });
    vi.mocked(EmbeddingModel).mockImplementation(function () {
      return {} as any;
    });
    Reflect.set(FileModel, 'getFileById', undefined);

    mockCtx = { serverDB: {}, userId };
  });

  it('does NOT delete the file row when storage returns NoSuchKey; marks task Error and throws', async () => {
    fileModelMock.findById.mockResolvedValue({
      id: 'file_xyz',
      name: 'doc.pdf',
      url: 'https://example.com/doc.pdf',
    });
    fileServiceMock.getFileByteArray.mockRejectedValue({ Code: 'NoSuchKey' });

    const caller = fileRouter.createCaller(mockCtx);

    await expect(
      caller.parseFileToChunks({ fileId: 'file_xyz', taskId: 'task_1' }),
    ).rejects.toThrow(TRPCError);

    expect(fileModelMock.delete).not.toHaveBeenCalled();
    expect(asyncTaskModelMock.update).toHaveBeenCalledWith(
      'task_1',
      expect.objectContaining({
        status: AsyncTaskStatus.Error,
        error: expect.objectContaining({
          name: expect.any(String),
        }),
      }),
    );
  });

  it('rejects oversized files before reading them into memory', async () => {
    fileModelMock.findById.mockResolvedValue({
      id: 'large-file',
      name: 'large.pdf',
      size: 64 * 1024 * 1024 + 1,
      url: 'https://example.com/large.pdf',
    });

    const caller = fileRouter.createCaller(mockCtx);

    await expect(
      caller.parseFileToChunks({ fileId: 'large-file', taskId: 'task-large' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(fileServiceMock.getFileByteArray).not.toHaveBeenCalled();
    expect(asyncTaskModelMock.update).toHaveBeenCalledWith('task-large', {
      error: new AsyncTaskError(
        AsyncTaskErrorType.FileTooLargeToParse,
        'Files larger than 67108864 bytes cannot be parsed in memory',
      ),
      status: AsyncTaskStatus.Error,
    });
  });

  it('skips storage fetch and returns gracefully when url is internal://', async () => {
    fileModelMock.findById.mockResolvedValue({
      id: 'file_inline',
      name: 'note',
      url: 'internal://document/placeholder',
    });

    const caller = fileRouter.createCaller(mockCtx);
    const result = await caller.parseFileToChunks({
      fileId: 'file_inline',
      taskId: 'task_2',
    });

    expect(fileServiceMock.getFileByteArray).not.toHaveBeenCalled();
    expect(fileModelMock.delete).not.toHaveBeenCalled();
    expect(asyncTaskModelMock.update).toHaveBeenCalledWith(
      'task_2',
      expect.objectContaining({ status: AsyncTaskStatus.Error }),
    );
    expect(result).toMatchObject({ success: false });
  });

  it('resolves workspaceId from the file row when async payload omits it', async () => {
    Reflect.set(
      FileModel,
      'getFileById',
      vi.fn().mockResolvedValue({
        id: 'file_workspace',
        userId,
        workspaceId: 'workspace-1',
      }),
    );
    fileModelMock.findById.mockResolvedValue({
      id: 'file_workspace',
      name: 'workspace note',
      url: 'internal://document/placeholder',
    });

    const caller = fileRouter.createCaller(mockCtx);

    await caller.parseFileToChunks({
      fileId: 'file_workspace',
      taskId: 'task_workspace',
    });

    expect(AsyncTaskModel).toHaveBeenCalledWith(mockCtx.serverDB, userId, 'workspace-1');
    expect(ChunkModel).toHaveBeenCalledWith(mockCtx.serverDB, userId, 'workspace-1');
    expect(ChunkService).toHaveBeenCalledWith(mockCtx.serverDB, userId, 'workspace-1');
    expect(DocumentService).toHaveBeenCalledWith(mockCtx.serverDB, userId, 'workspace-1');
    expect(FileModel).toHaveBeenCalledWith(mockCtx.serverDB, userId, 'workspace-1');
  });

  it('marks task Error and propagates for non-NoSuchKey storage errors (does not delete)', async () => {
    fileModelMock.findById.mockResolvedValue({
      id: 'file_other',
      name: 'doc.pdf',
      url: 'https://example.com/doc.pdf',
    });
    fileServiceMock.getFileByteArray.mockRejectedValue({
      Code: 'AccessDenied',
      message: 'forbidden',
    });

    const caller = fileRouter.createCaller(mockCtx);

    await expect(
      caller.parseFileToChunks({ fileId: 'file_other', taskId: 'task_3' }),
    ).rejects.toThrow();

    expect(fileModelMock.delete).not.toHaveBeenCalled();
    expect(asyncTaskModelMock.update).toHaveBeenCalledWith(
      'task_3',
      expect.objectContaining({ status: AsyncTaskStatus.Error }),
    );
  });

  describe('parse concurrency', () => {
    // lets every already-unblocked promise chain run to its next real wait
    const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

    const deferred = () => {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => {
        resolve = r;
      });
      return { promise, resolve };
    };

    beforeEach(() => {
      fileModelMock.findById.mockImplementation(async (id: string) => ({
        fileType: 'text/plain',
        id,
        name: `${id}.txt`,
        size: 10,
        url: `https://example.com/${id}.txt`,
      }));
      asyncTaskModelMock.findById.mockResolvedValue({ id: 'task' });
      chunkServiceMock.chunkContent.mockResolvedValue({
        chunks: [{ index: 0, text: 'hello', type: 'DocumentChunk' }],
      });
    });

    it('holds a batch of files back so only two are downloaded and parsed at a time', async () => {
      const gates = new Map<string, ReturnType<typeof deferred>>();
      let inFlight = 0;
      let peak = 0;
      fileServiceMock.getFileByteArray.mockImplementation(async (url: string) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        const gate = deferred();
        gates.set(url, gate);
        await gate.promise;
        inFlight--;
        return new Uint8Array([1]);
      });

      const caller = fileRouter.createCaller(mockCtx);
      const ids = ['f1', 'f2', 'f3', 'f4', 'f5'];
      const runs = ids.map((id) => caller.parseFileToChunks({ fileId: id, taskId: `task_${id}` }));

      await flush();
      expect(gates.size).toBe(2);

      // release files one by one; every finished file lets exactly one waiting file start
      for (let done = 0; done < ids.length; done++) {
        const [url, gate] = [...gates.entries()][0];
        gates.delete(url);
        gate.resolve();
        await flush();
        expect(gates.size).toBe(Math.min(2, ids.length - done - 1));
      }

      const results = await Promise.all(runs);
      expect(results).toEqual(ids.map(() => ({ success: true })));
      expect(peak).toBe(2);
    });

    it('frees the slot of a file that fails, so later files still run', async () => {
      fileServiceMock.getFileByteArray
        .mockRejectedValueOnce({ Code: 'NoSuchKey' })
        .mockRejectedValueOnce({ Code: 'AccessDenied', message: 'forbidden' })
        .mockResolvedValue(new Uint8Array([1]));

      const caller = fileRouter.createCaller(mockCtx);
      const results = await Promise.allSettled(
        ['f1', 'f2', 'f3', 'f4'].map((id) =>
          caller.parseFileToChunks({ fileId: id, taskId: `task_${id}` }),
        ),
      );

      expect(results.map((r) => r.status)).toEqual([
        'rejected',
        'rejected',
        'fulfilled',
        'fulfilled',
      ]);
    });

    it('keeps the slot of a file that timed out until its parsing really ends', async () => {
      vi.useFakeTimers();
      try {
        const stuck = deferred();
        fileServiceMock.getFileByteArray.mockResolvedValue(new Uint8Array([1]));
        chunkServiceMock.chunkContent.mockImplementation(async () => {
          await stuck.promise;
          return { chunks: [{ index: 0, text: 'hello', type: 'DocumentChunk' }] };
        });

        const caller = fileRouter.createCaller(mockCtx);
        const runs = ['f1', 'f2', 'f3'].map((id) =>
          caller.parseFileToChunks({ fileId: id, taskId: `task_${id}` }),
        );

        // both running files give up waiting, but their parsing is still going on
        await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
        await expect(runs[0]).resolves.toMatchObject({ success: false });
        await expect(runs[1]).resolves.toMatchObject({ success: false });
        expect(fileServiceMock.getFileByteArray).toHaveBeenCalledTimes(2);

        stuck.resolve();
        await vi.advanceTimersByTimeAsync(0);
        expect(fileServiceMock.getFileByteArray).toHaveBeenCalledTimes(3);
        await expect(runs[2]).resolves.toEqual({ success: true });
      } finally {
        vi.useRealTimers();
      }
    });

    it('restarts the task clock when a queued file finally starts parsing', async () => {
      vi.useFakeTimers();
      try {
        const gates: ReturnType<typeof deferred>[] = [];
        fileServiceMock.getFileByteArray.mockResolvedValue(new Uint8Array([1]));
        chunkServiceMock.chunkContent.mockImplementation(async () => {
          const gate = deferred();
          gates.push(gate);
          await gate.promise;
          return { chunks: [{ index: 0, text: 'hello', type: 'DocumentChunk' }] };
        });

        const caller = fileRouter.createCaller(mockCtx);
        const runs = ['f1', 'f2', 'f3'].map((id) =>
          caller.parseFileToChunks({ fileId: id, taskId: `task_${id}` }),
        );

        // f3 waits four minutes behind the two running files
        await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
        expect(documentServiceMock.parseFile).not.toHaveBeenCalledWith('f3');
        const admittedAt = new Date();
        gates[0].resolve();
        await vi.advanceTimersByTimeAsync(0);

        expect(asyncTaskModelMock.update).toHaveBeenCalledWith('task_f3', {
          createdAt: admittedAt,
          error: null,
          status: AsyncTaskStatus.Processing,
        });

        gates.forEach((gate) => gate.resolve());
        await vi.advanceTimersByTimeAsync(0);
        gates.forEach((gate) => gate.resolve());
        await Promise.all(runs);
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps a queued task fresh for status polling beyond the parse timeout', async () => {
      vi.useFakeTimers();
      const stuck = deferred();
      let runs: Promise<unknown>[] = [];
      try {
        const taskStates = new Map<
          string,
          { createdAt: Date; error: unknown; status: AsyncTaskStatus }
        >(
          ['f1', 'f2', 'f3'].map((id) => [
            'task_' + id,
            { createdAt: new Date(), error: null, status: AsyncTaskStatus.Processing },
          ]),
        );
        asyncTaskModelMock.update.mockImplementation(async (id: string, value: object) => {
          const previous = taskStates.get(id) ?? {
            createdAt: new Date(),
            error: null,
            status: AsyncTaskStatus.Processing,
          };
          taskStates.set(id, { ...previous, ...value });
        });
        fileServiceMock.getFileByteArray.mockResolvedValue(new Uint8Array([1]));
        chunkServiceMock.chunkContent.mockImplementation(async () => {
          await stuck.promise;
          return { chunks: [{ index: 0, text: 'hello', type: 'DocumentChunk' }] };
        });
        const caller = fileRouter.createCaller(mockCtx);
        runs = ['f1', 'f2', 'f3'].map((id) =>
          caller.parseFileToChunks({ fileId: id, taskId: 'task_' + id }),
        );
        // Model the watchdog on every poll while both parse slots stay occupied.
        for (let minute = 0; minute < 10; minute++) {
          await vi.advanceTimersByTimeAsync(60_000);
          const task = taskStates.get('task_f3');
          expect(task).toBeDefined();
          if (task && Date.now() - task.createdAt.getTime() > ASYNC_TASK_TIMEOUT) {
            task.status = AsyncTaskStatus.Error;
          }
          expect(task?.status).toBe(AsyncTaskStatus.Processing);
        }
        expect(fileServiceMock.getFileByteArray).toHaveBeenCalledTimes(2);
        stuck.resolve();
        await vi.advanceTimersByTimeAsync(0);
        await Promise.all(runs);
        expect(taskStates.get('task_f3')?.status).toBe(AsyncTaskStatus.Success);
        const updatesAfterCompletion = asyncTaskModelMock.update.mock.calls.length;
        await vi.advanceTimersByTimeAsync(ASYNC_TASK_TIMEOUT * 2);
        expect(asyncTaskModelMock.update).toHaveBeenCalledTimes(updatesAfterCompletion);
      } finally {
        stuck.resolve();
        await vi.advanceTimersByTimeAsync(0);
        await Promise.allSettled(runs);
        vi.useRealTimers();
      }
    });

    it('does not keep a parse slot while the embedding task of a finished file runs', async () => {
      const embedding = deferred();
      chunkServiceMock.asyncEmbeddingFileChunks.mockImplementation(() => embedding.promise);
      fileServiceMock.getFileByteArray.mockResolvedValue(new Uint8Array([1]));

      const caller = fileRouter.createCaller(mockCtx);
      const runs = ['f1', 'f2', 'f3', 'f4'].map((id) =>
        caller.parseFileToChunks({ fileId: id, taskId: `task_${id}` }),
      );

      await flush();
      // all four are chunked although every one of them is still waiting on its embedding call
      expect(chunkModelMock.bulkCreate).toHaveBeenCalledTimes(4);

      embedding.resolve();
      await Promise.all(runs);
    });
  });
});
