// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { ChunkModel } from '@/database/models/chunk';
import { EmbeddingModel } from '@/database/models/embedding';
import { FileModel } from '@/database/models/file';
import { ChunkService } from '@/server/services/chunk';
import { DocumentService } from '@/server/services/document';
import { FileService } from '@/server/services/file';
import { AsyncTaskStatus } from '@/types/asyncTask';

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

    vi.mocked(AsyncTaskModel).mockImplementation(() => asyncTaskModelMock);
    vi.mocked(FileModel).mockImplementation(() => fileModelMock);
    vi.mocked(FileService).mockImplementation(() => fileServiceMock);
    vi.mocked(ChunkService).mockImplementation(() => chunkServiceMock);
    vi.mocked(DocumentService).mockImplementation(() => documentServiceMock);
    vi.mocked(ChunkModel).mockImplementation(() => chunkModelMock);
    vi.mocked(EmbeddingModel).mockImplementation(() => ({}) as any);

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
});
