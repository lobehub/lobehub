// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { MAX_FILE_PARSE_SIZE } from '@/const/file';

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

const makeCtx = (contentLength: number) => ({
  fileService: {
    getFileByteArray: vi.fn().mockResolvedValue(new Uint8Array([1])),
    getFileContent: vi.fn().mockResolvedValue('a,b\n1,2'),
    getFileMetadata: vi.fn().mockResolvedValue({ contentLength }),
  },
  fileUploadService: {
    assertActiveOrLegacy: vi.fn().mockResolvedValue(undefined),
    releaseBestEffort: vi.fn(),
  },
});

describe('dataset parse routes and the parse size cap', () => {
  const caller = (ctx: object) => datasetRouter.createCaller(ctx as never);

  it.each([
    [
      'parseDatasetFile',
      (c: ReturnType<typeof caller>) => c.parseDatasetFile({ pathname: 'p.xlsx', format: 'xlsx' }),
    ],
    [
      'importDataset',
      (c: ReturnType<typeof caller>) =>
        c.importDataset({
          datasetId: 'd',
          fieldMapping: { input: 'a' },
          filename: 'big.xlsx',
          pathname: 'p.xlsx',
        }),
    ],
  ])('%s refuses an oversized upload before reading or cloning its bytes', async (_, call) => {
    const ctx = makeCtx(MAX_FILE_PARSE_SIZE + 1);

    const error = await call(caller(ctx)).catch((e: unknown) => e);

    expect(error).toMatchObject({ code: 'BAD_REQUEST' });
    expect((error as Error).message).toContain('cannot be parsed in memory');
    expect(ctx.fileService.getFileByteArray).not.toHaveBeenCalled();
    expect(ctx.fileService.getFileContent).not.toHaveBeenCalled();
    expect(parseDatasetInWorker).not.toHaveBeenCalled();
  });

  it('releases the claimed upload when parseDatasetFile refuses an oversized file', async () => {
    const ctx = makeCtx(MAX_FILE_PARSE_SIZE + 1);
    ctx.fileUploadService.assertActiveOrLegacy.mockResolvedValue({ id: 'upload' });

    await expect(
      caller(ctx).parseDatasetFile({ pathname: 'p.csv', format: 'csv' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(ctx.fileUploadService.releaseBestEffort).toHaveBeenCalledWith('p.csv');
  });

  it('reads and parses a dataset within the cap on the worker', async () => {
    const ctx = makeCtx(MAX_FILE_PARSE_SIZE);
    parseDatasetInWorker.mockResolvedValue({
      format: 'csv',
      headers: ['a'],
      rows: [],
      totalCount: 0,
    });

    await caller(ctx).parseDatasetFile({ pathname: 'p.csv', format: 'csv' });

    expect(parseDatasetInWorker).toHaveBeenCalledTimes(1);
  });
});
