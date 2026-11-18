// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FileParseError } from '@/server/services/fileParse';

import { datasetRouter } from './datasets';

const parseDatasetInWorker = vi.hoisted(() => vi.fn());
vi.mock('@/server/services/fileParse', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  parseDatasetInWorker,
}));
vi.mock('./procedures', async () => {
  // Pass-through procedures: the auth chain is not what is under test.
  const { initTRPC } = await import('@trpc/server');
  const t = initTRPC.context<object>().create();
  return { agentEvalProcedure: t.procedure, agentEvalProcedureWrite: t.procedure };
});
vi.mock('@/libs/trpc/lambda', async () => {
  const { initTRPC } = await import('@trpc/server');
  return { router: initTRPC.context<object>().create().router };
});

const PATHNAME = 'eval/upload.csv';
const PARSED = { format: 'csv', headers: ['q'], rows: [{ q: 'hi' }], totalCount: 1 };

/** An upload session that behaves like the real one: once released, the same pathname is gone. */
const makeCtx = () => {
  let active = true;
  const ctx = {
    fileService: {
      deleteFile: vi.fn(),
      getFileByteArray: vi.fn().mockResolvedValue(new Uint8Array([1])),
      getFileContent: vi.fn().mockResolvedValue('q\nhi'),
      getFileMetadata: vi.fn().mockResolvedValue({ contentLength: 4 }),
    },
    fileUploadService: {
      assertActiveOrLegacy: vi.fn(async () => {
        if (!active) throw new TRPCError({ code: 'CONFLICT', message: 'no longer active' });
        return { id: 'upload' };
      }),
      releaseBestEffort: vi.fn(async () => {
        active = false;
      }),
    },
    testCaseModel: {
      batchCreate: vi.fn(async (rows: unknown[]) => rows),
      countByDatasetId: vi.fn().mockResolvedValue(0),
    },
  };
  return { ctx, isActive: () => active };
};

type Caller = ReturnType<typeof datasetRouter.createCaller>;
const entries: Array<[string, (c: Caller) => Promise<unknown>]> = [
  ['parseDatasetFile', (c) => c.parseDatasetFile({ format: 'csv', pathname: PATHNAME })],
  [
    'importDataset',
    (c) => c.importDataset({ datasetId: 'd', fieldMapping: { input: 'q' }, pathname: PATHNAME }),
  ],
];

/** Same name and code, different class: what another bundle copy of FileParseError looks like. */
const otherCopyError = (code: string) =>
  Object.assign(new Error(`${code} from another copy`), { code, name: 'FileParseError' });

describe.each(entries)('%s with the shared parse worker', (_, call) => {
  const caller = (ctx: object) => datasetRouter.createCaller(ctx as never);

  beforeEach(() => parseDatasetInWorker.mockReset());

  it.each([
    ['QUEUE_FULL', 'TOO_MANY_REQUESTS'],
    ['QUEUE_TIMEOUT', 'TOO_MANY_REQUESTS'],
    ['UNAVAILABLE', 'SERVICE_UNAVAILABLE'],
    ['START_FAILED', 'SERVICE_UNAVAILABLE'],
    ['WORKER_FAILED', 'SERVICE_UNAVAILABLE'],
  ] as const)(
    'keeps the upload and answers a retryable %s as %s, then the same pathname succeeds',
    async (fileParseCode, trpcCode) => {
      const { ctx, isActive } = makeCtx();
      parseDatasetInWorker.mockRejectedValueOnce(new FileParseError(fileParseCode, 'busy'));

      const error = await call(caller(ctx)).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(TRPCError);
      expect(error).toMatchObject({ code: trpcCode });
      expect(ctx.fileUploadService.releaseBestEffort).not.toHaveBeenCalled();
      expect(ctx.fileService.deleteFile).not.toHaveBeenCalled();
      expect(ctx.testCaseModel.batchCreate).not.toHaveBeenCalled();
      expect(isActive()).toBe(true);

      parseDatasetInWorker.mockResolvedValueOnce(PARSED);
      await expect(call(caller(ctx))).resolves.toBeTruthy();
      expect(parseDatasetInWorker).toHaveBeenCalledTimes(2);
    },
  );

  it('recognises a retryable error from another module copy by name and code', async () => {
    const { ctx, isActive } = makeCtx();
    parseDatasetInWorker.mockRejectedValueOnce(otherCopyError('QUEUE_TIMEOUT'));

    const error = await call(caller(ctx)).catch((e: unknown) => e);

    expect(error).toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    expect(ctx.fileUploadService.releaseBestEffort).not.toHaveBeenCalled();
    expect(isActive()).toBe(true);
  });

  it.each([
    new FileParseError('PARSE_FAILED', 'bad csv'),
    new FileParseError('LOAD_FAILED', 'nothing usable'),
    new FileParseError('OUTPUT_TOO_LARGE', 'too big'),
    new FileParseError('TIMEOUT', 'too slow'),
    new FileParseError('OUT_OF_MEMORY', 'heap'),
    otherCopyError('PARSE_FAILED'),
    new Error('plain parser failure'),
  ])('still releases the upload and rejects a deterministic failure (%s)', async (failure) => {
    const { ctx, isActive } = makeCtx();
    parseDatasetInWorker.mockRejectedValueOnce(failure);

    const error = await call(caller(ctx)).catch((e: unknown) => e);

    expect(error).toMatchObject({ code: 'BAD_REQUEST' });
    expect((error as Error).message).toContain('Failed to parse file');
    expect(ctx.fileUploadService.releaseBestEffort).toHaveBeenCalledWith(PATHNAME);
    expect(ctx.testCaseModel.batchCreate).not.toHaveBeenCalled();
    expect(isActive()).toBe(false);
  });
});

describe('importDataset consumes the upload only on success', () => {
  it('imports the rows and releases the upload once', async () => {
    const { ctx, isActive } = makeCtx();
    parseDatasetInWorker.mockReset().mockResolvedValue(PARSED);

    const result = await datasetRouter
      .createCaller(ctx as never)
      .importDataset({ datasetId: 'd', fieldMapping: { input: 'q' }, pathname: PATHNAME });

    expect(result.count).toBe(1);
    expect(ctx.testCaseModel.batchCreate).toHaveBeenCalledTimes(1);
    expect(ctx.fileUploadService.releaseBestEffort).toHaveBeenCalledTimes(1);
    expect(isActive()).toBe(false);
  });
});
