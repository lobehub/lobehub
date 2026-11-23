// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { ChunkModel } from '@/database/models/chunk';
import { EmbeddingModel } from '@/database/models/embedding';
import { FileModel } from '@/database/models/file';
import { ChunkService } from '@/server/services/chunk';
import { DocumentService } from '@/server/services/document';
import { FileService } from '@/server/services/file';

import { fileRouter } from '../file';

const { release, renew } = vi.hoisted(() => ({
  release: vi.fn(async () => undefined),
  renew: vi.fn(async () => undefined),
}));

vi.mock('@/server/services/redis', () => ({
  redisService: { fileTaskSlots: { acquire: vi.fn(), release, renew } },
}));
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
  const { asyncTrpc } = await vi.importActual<{ asyncTrpc: any }>('@/libs/trpc/async/init');
  return {
    asyncAuthedProcedure: asyncTrpc.procedure,
    asyncRouter: asyncTrpc.router,
    createAsyncCallerFactory: asyncTrpc.createCallerFactory,
    publicProcedure: asyncTrpc.procedure,
  };
});

const scope = 'workspace:ws-1';

describe('fileRouter admission slot', () => {
  let asyncEmbeddingFileChunks: ReturnType<typeof vi.fn>;
  let findFile: ReturnType<typeof vi.fn>;

  const caller = () => fileRouter.createCaller({ serverDB: {}, userId: 'user' } as any);

  beforeEach(() => {
    vi.clearAllMocks();
    asyncEmbeddingFileChunks = vi.fn(async () => 'embedding-task');
    findFile = vi.fn(async () => ({
      fileType: 'text/plain',
      id: 'file',
      name: 'file.txt',
      size: 10,
      url: 'https://example.com/file.txt',
    }));

    const construct = <T>(mock: unknown, value: T) =>
      vi.mocked(mock as any).mockImplementation(function () {
        return value;
      });
    construct(AsyncTaskModel, {
      findById: vi.fn(async () => ({ id: 'task' })),
      update: vi.fn(async () => undefined),
    });
    construct(ChunkModel, { bulkCreate: vi.fn(async () => undefined) });
    construct(EmbeddingModel, {});
    construct(FileModel, { findById: findFile });
    construct(FileService, { getFileByteArray: vi.fn(async () => new Uint8Array([1])) });
    construct(DocumentService, { parseFile: vi.fn(async () => undefined) });
    construct(ChunkService, {
      asyncEmbeddingFileChunks,
      chunkContent: vi.fn(async () => ({ chunks: [{ id: 'c', index: 0, text: 'text' }] })),
    });
    Reflect.set(FileModel, 'getFileById', undefined);
  });

  it('keeps one slot through parse and embedding, and frees it only afterwards', async () => {
    let finishEmbedding!: () => void;
    asyncEmbeddingFileChunks.mockImplementation(
      () => new Promise((resolve) => (finishEmbedding = () => resolve('embedding-task'))),
    );

    const run = caller().parseFileToChunks({
      admissionScope: scope,
      fileId: 'file',
      taskId: 'task',
      workspaceId: 'ws-1',
    });
    await vi.waitFor(() => expect(asyncEmbeddingFileChunks).toHaveBeenCalled());

    expect(asyncEmbeddingFileChunks).toHaveBeenCalledWith('file', { inheritedSlot: true });
    expect(release).not.toHaveBeenCalled();

    finishEmbedding();
    await run;

    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(scope, 'task');
  });

  it('admits embedding on its own when the parse holds no slot', async () => {
    await caller().parseFileToChunks({ fileId: 'file', taskId: 'task' });

    expect(asyncEmbeddingFileChunks).toHaveBeenCalledWith('file');
    expect(release).not.toHaveBeenCalled();
  });

  it('frees the slot when the route rejects the task', async () => {
    findFile.mockResolvedValue(undefined);

    await expect(
      caller().embeddingChunks({ admissionScope: scope, fileId: 'file', taskId: 'task' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(release).toHaveBeenCalledWith(scope, 'task');
  });
});
