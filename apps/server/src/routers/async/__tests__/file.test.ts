// @vitest-environment node
import { FileParseBudgetError } from '@lobechat/file-loaders';
import { TRPCError } from '@trpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { ChunkModel } from '@/database/models/chunk';
import { EmbeddingModel } from '@/database/models/embedding';
import { FileModel } from '@/database/models/file';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { ChunkService } from '@/server/services/chunk';
import { DocumentService } from '@/server/services/document';
import { FileService } from '@/server/services/file';
import { FileParseError } from '@/server/services/fileParse/errors';
import { normalizeParseFileError } from '@/server/services/fileParse/normalizeError';
import { AsyncTaskError, AsyncTaskErrorType, AsyncTaskStatus } from '@/types/asyncTask';

import { fileRouter } from '../file';

vi.mock('@/database/models/asyncTask', () => ({ AsyncTaskModel: vi.fn() }));
vi.mock('@/database/models/chunk', () => ({ ChunkModel: vi.fn() }));
vi.mock('@/database/models/embedding', () => ({ EmbeddingModel: vi.fn() }));
vi.mock('@/database/models/file', () => ({ FileModel: vi.fn() }));
vi.mock('@/server/modules/ModelRuntime', () => ({ initModelRuntimeFromDB: vi.fn() }));
vi.mock('@/server/globalConfig', () => ({ getServerDefaultFilesConfig: async () => ({}) }));
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
        expect(asyncTaskModelMock.update).not.toHaveBeenCalledWith('task_f3', expect.anything());
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

describe('fileRouter.parseFileToChunks — document parse fallback and late persistence', () => {
  const userId = 'user_test';
  let asyncTaskModelMock: any;
  let chunkModelMock: any;
  let chunkServiceMock: any;
  let documentServiceMock: any;
  let caller: ReturnType<typeof fileRouter.createCaller>;

  beforeEach(() => {
    vi.clearAllMocks();
    asyncTaskModelMock = { findById: vi.fn().mockResolvedValue({ id: 'task' }), update: vi.fn() };
    chunkModelMock = { bulkCreate: vi.fn(), bulkCreateUnstructuredChunks: vi.fn() };
    chunkServiceMock = {
      asyncEmbeddingFileChunks: vi.fn(),
      chunkContent: vi.fn().mockResolvedValue({
        chunks: [{ index: 0, text: 'hello', type: 'DocumentChunk' }],
      }),
    };
    documentServiceMock = { parseFile: vi.fn() };
    const fileModelMock = {
      findById: vi.fn().mockResolvedValue({
        fileType: 'application/vnd.ms-excel',
        id: 'file',
        name: 'book.xlsx',
        size: 10,
        url: 'https://example.com/book.xlsx',
      }),
    };

    vi.mocked(AsyncTaskModel).mockImplementation(function () {
      return asyncTaskModelMock;
    });
    vi.mocked(FileModel).mockImplementation(function () {
      return fileModelMock as any;
    });
    vi.mocked(FileService).mockImplementation(function () {
      return { getFileByteArray: vi.fn().mockResolvedValue(new Uint8Array([1])) } as any;
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
    caller = fileRouter.createCaller({ serverDB: {}, userId } as any);
  });

  const run = () => caller.parseFileToChunks({ fileId: 'file', taskId: 'task_v' });

  it.each([
    [
      'the input size cap',
      () => normalizeParseFileError(new FileParseError('INPUT_TOO_LARGE', 'too big')),
    ],
    [
      'the xlsx ZIP structure budget',
      () => normalizeParseFileError(new FileParseBudgetError('zip-expansion', 1, 2)),
    ],
  ])('does not run the chunk parse a second time after %s refused the file', async (_, failure) => {
    documentServiceMock.parseFile.mockRejectedValue(failure());

    await expect(run()).resolves.toMatchObject({ success: false });

    // the chunk job reads the same bytes under the same limit: it would be refused too
    expect(chunkServiceMock.chunkContent).not.toHaveBeenCalled();
    expect(chunkModelMock.bulkCreate).not.toHaveBeenCalled();
    expect(asyncTaskModelMock.update).toHaveBeenLastCalledWith(
      'task_v',
      expect.objectContaining({
        error: expect.objectContaining({ name: AsyncTaskErrorType.FileTooLargeToParse }),
        status: AsyncTaskStatus.Error,
      }),
    );
    expect(asyncTaskModelMock.update).not.toHaveBeenCalledWith(
      'task_v',
      expect.objectContaining({ status: AsyncTaskStatus.Success }),
    );
  });

  it.each([
    [
      'a document parser that cannot read the file',
      () => normalizeParseFileError(new FileParseError('LOAD_FAILED', 'no usable pages')),
    ],
    [
      'a corrupt file for the document parser',
      () => normalizeParseFileError(new FileParseError('PARSE_FAILED', 'bad pdf')),
    ],
    [
      'the document parser sheet-cells budget, which the chunk loader does not apply',
      () => normalizeParseFileError(new FileParseBudgetError('sheet-cells', 5_000_000, 6_000_000)),
    ],
    [
      'a document parse timeout',
      () => normalizeParseFileError(new FileParseError('TIMEOUT', 'too slow')),
    ],
    [
      'a document parse out of memory',
      () => normalizeParseFileError(new FileParseError('OUT_OF_MEMORY', 'heap limit')),
    ],
    ['a busy parse queue', () => normalizeParseFileError(new FileParseError('QUEUE_FULL', 'busy'))],
    ['an unrelated error', () => new Error('document db unavailable')],
  ])('still chunks after %s, and the task succeeds with those chunks', async (_, failure) => {
    documentServiceMock.parseFile.mockRejectedValue(failure());

    await expect(run()).resolves.toEqual({ success: true });

    expect(chunkServiceMock.chunkContent).toHaveBeenCalledTimes(1);
    expect(chunkModelMock.bulkCreate).toHaveBeenCalledWith(
      [expect.objectContaining({ index: 0 })],
      'file',
    );
    expect(asyncTaskModelMock.update).toHaveBeenLastCalledWith(
      'task_v',
      expect.objectContaining({ status: AsyncTaskStatus.Success }),
    );
    expect(asyncTaskModelMock.update).not.toHaveBeenCalledWith(
      'task_v',
      expect.objectContaining({ status: AsyncTaskStatus.Error }),
    );
  });

  it('records an error when the document parser and the chunk parser both fail', async () => {
    documentServiceMock.parseFile.mockRejectedValue(
      normalizeParseFileError(new FileParseError('LOAD_FAILED', 'no usable pages')),
    );
    chunkServiceMock.chunkContent.mockRejectedValue(
      new FileParseError('PARSE_FAILED', 'cannot split'),
    );

    await expect(run()).resolves.toMatchObject({ success: false });

    expect(chunkServiceMock.chunkContent).toHaveBeenCalledTimes(1);
    expect(chunkModelMock.bulkCreate).not.toHaveBeenCalled();
    expect(asyncTaskModelMock.update).toHaveBeenLastCalledWith(
      'task_v',
      expect.objectContaining({ status: AsyncTaskStatus.Error }),
    );
    expect(asyncTaskModelMock.update).not.toHaveBeenCalledWith(
      'task_v',
      expect.objectContaining({ status: AsyncTaskStatus.Success }),
    );
  });

  it('records a deterministic chunking failure as the task error and never as a success', async () => {
    chunkServiceMock.chunkContent.mockRejectedValue(
      new FileParseError('OUTPUT_TOO_LARGE', 'too many chunks'),
    );

    await expect(run()).resolves.toMatchObject({ success: false });

    expect(chunkModelMock.bulkCreate).not.toHaveBeenCalled();
    expect(asyncTaskModelMock.update).toHaveBeenLastCalledWith(
      'task_v',
      expect.objectContaining({
        error: expect.objectContaining({ name: AsyncTaskErrorType.FileTooLargeToParse }),
        status: AsyncTaskStatus.Error,
      }),
    );
  });

  it('writes nothing once the task has timed out, however late the chunking finishes', async () => {
    vi.useFakeTimers();
    try {
      let finish!: () => void;
      chunkServiceMock.chunkContent.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = () => resolve({ chunks: [{ index: 0, text: 'late', type: 'DocumentChunk' }] });
          }),
      );

      const running = run();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      await expect(running).resolves.toMatchObject({ success: false });
      expect(asyncTaskModelMock.update).toHaveBeenLastCalledWith(
        'task_v',
        expect.objectContaining({
          error: expect.objectContaining({ name: AsyncTaskErrorType.Timeout }),
          status: AsyncTaskStatus.Error,
        }),
      );

      finish();
      await vi.advanceTimersByTimeAsync(0);

      expect(chunkModelMock.bulkCreate).not.toHaveBeenCalled();
      expect(asyncTaskModelMock.update).not.toHaveBeenCalledWith(
        'task_v',
        expect.objectContaining({ status: AsyncTaskStatus.Success }),
      );
      expect(chunkServiceMock.asyncEmbeddingFileChunks).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('fileRouter.embeddingChunks', () => {
  const userId = 'user_test';
  const rateLimited = {
    error: { code: 'ModelAccountTpmRateLimitExceeded', status: 429 },
    errorType: 'ProviderBizError',
  };
  let asyncTaskModelMock: any;
  let chunkModelMock: any;
  let embeddingModelMock: any;
  let embeddings: ReturnType<typeof vi.fn>;

  const call = () =>
    fileRouter
      .createCaller({ serverDB: {}, userId } as any)
      .embeddingChunks({ fileId: 'f1', taskId: 't1' });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    asyncTaskModelMock = { findById: vi.fn().mockResolvedValue({ id: 't1' }), update: vi.fn() };
    chunkModelMock = {
      getChunksTextByFileId: vi.fn().mockResolvedValue([{ id: 'c1', text: 'hello' }]),
    };
    embeddingModelMock = { bulkCreate: vi.fn() };
    embeddings = vi.fn().mockResolvedValue([[0.1, 0.2]]);

    vi.mocked(AsyncTaskModel).mockImplementation(function () {
      return asyncTaskModelMock;
    });
    vi.mocked(ChunkModel).mockImplementation(function () {
      return chunkModelMock;
    });
    vi.mocked(EmbeddingModel).mockImplementation(function () {
      return embeddingModelMock;
    });
    vi.mocked(FileModel).mockImplementation(function () {
      return { findById: vi.fn().mockResolvedValue({ id: 'f1', name: 'a.md' }) } as any;
    });
    Reflect.set(FileModel, 'getFileById', undefined);
    vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ embeddings } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts the task clock when it begins, and embeds only the chunks still missing', async () => {
    vi.setSystemTime(new Date('2026-11-11T08:00:00Z'));

    await expect(call()).resolves.toEqual({ success: true });

    // The task may have waited in the queue: the watchdog counts from here.
    expect(asyncTaskModelMock.update).toHaveBeenNthCalledWith(1, 't1', {
      createdAt: new Date('2026-11-11T08:00:00Z'),
      error: null,
      status: AsyncTaskStatus.Processing,
    });
    expect(chunkModelMock.getChunksTextByFileId).toHaveBeenCalledWith('f1', {
      withoutEmbedding: true,
    });
    expect(embeddingModelMock.bulkCreate).toHaveBeenCalledWith([
      { chunkId: 'c1', embeddings: [0.1, 0.2], fileId: 'f1', model: expect.any(String) },
    ]);
  });

  it('keeps the task running through a rate limit and succeeds once the provider recovers', async () => {
    embeddings.mockRejectedValueOnce(rateLimited).mockRejectedValueOnce(rateLimited);

    const result = call();
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(result).resolves.toEqual({ success: true });
    expect(embeddings).toHaveBeenCalledTimes(3);
    expect(asyncTaskModelMock.update).toHaveBeenLastCalledWith(
      't1',
      expect.objectContaining({ status: AsyncTaskStatus.Success }),
    );
    expect(asyncTaskModelMock.update).not.toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ status: AsyncTaskStatus.Error }),
    );
  });

  it('fails the task with the provider error when the rate limit outlasts its budget', async () => {
    embeddings.mockRejectedValue(rateLimited);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = call();
    await vi.advanceTimersByTimeAsync(15 * 60_000);

    await expect(result).resolves.toMatchObject({ success: false });
    expect(asyncTaskModelMock.update).toHaveBeenLastCalledWith('t1', {
      error: new AsyncTaskError(AsyncTaskErrorType.EmbeddingError, 'ProviderBizError'),
      status: AsyncTaskStatus.Error,
    });
    errorSpy.mockRestore();
  });

  it('fails at once on an error a retry cannot fix', async () => {
    embeddings.mockRejectedValue({ error: { status: 401 }, errorType: 'InvalidProviderAPIKey' });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(call()).resolves.toMatchObject({ success: false });

    expect(embeddings).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });
});
