// @vitest-environment node
import { strToU8, zipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentEvalDatasetWriteError } from '@/database/models/agentEval/datasetAccess';
import type * as DatasetPackageRepository from '@/database/repositories/agentEvalDatasetPackage';
import { AgentEvalDatasetPackageImportError } from '@/database/repositories/agentEvalDatasetPackage';
import { createCallerFactory } from '@/libs/trpc/lambda';
import { EvalConnectorBindingError } from '@/server/services/agentEvalConnector';

import { datasetRouter } from './datasets';

const mocks = vi.hoisted(() => ({
  importPackage: vi.fn(),
  assertActiveOrLegacy: vi.fn(),
  getFileByteArray: vi.fn(),
  getFileMetadata: vi.fn(),
  deleteFile: vi.fn(),
  releaseBestEffort: vi.fn(),
  validateBindings: vi.fn(),
}));
vi.mock('@/database/repositories/agentEvalDatasetPackage', async (importOriginal) => {
  const actual = await importOriginal<typeof DatasetPackageRepository>();
  return {
    ...actual,
    AgentEvalDatasetPackageRepo: class {
      importPackage = mocks.importPackage;
    },
  };
});
vi.mock('./procedures', async () => {
  const { publicProcedure } = await import('@/libs/trpc/lambda');
  const procedure = publicProcedure.use((opts) =>
    opts.next({
      ctx: {
        evalConnectorServiceForDataset: () => ({ validateBindings: mocks.validateBindings }),
        fileUploadService: {
          assertActiveOrLegacy: mocks.assertActiveOrLegacy,
          releaseBestEffort: mocks.releaseBestEffort,
        },
        fileService: {
          getFileByteArray: mocks.getFileByteArray,
          getFileMetadata: mocks.getFileMetadata,
          deleteFile: mocks.deleteFile,
        },
        userId: 'synthetic-owner',
        serverDB: {},
      } as any,
    }),
  );
  return { agentEvalProcedure: procedure, agentEvalProcedureWrite: procedure };
});
const caller = createCallerFactory(datasetRouter)({} as any);
const manifest = {
  format: 'lobehub-eval-dataset',
  version: 1,
  dataset: {
    name: 'Synthetic only',
    evalMode: 'equals',
    metadata: { mock: { dataset: 'example-v1' } },
  },
  cases: [{ key: 'one', content: { input: 'hello', expected: 'world' }, environmentKey: 'world' }],
  environments: [{ key: 'world', name: 'World', config: { mock: { services: ['example'] } } }],
};
const archive = (value: unknown) => zipSync({ 'dataset.json': strToU8(JSON.stringify(value)) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.assertActiveOrLegacy.mockResolvedValue({ id: 'upload' });
  mocks.getFileByteArray.mockResolvedValue(archive(manifest));
  mocks.getFileMetadata.mockResolvedValue({ contentLength: 1024 });
  mocks.importPackage.mockResolvedValue({
    datasetId: 'new-dataset',
    benchmarkId: 'new-benchmark',
    count: 1,
    environmentCount: 1,
  });
  mocks.releaseBestEffort.mockResolvedValue(undefined);
  mocks.deleteFile.mockResolvedValue(undefined);
  mocks.validateBindings.mockResolvedValue(undefined);
});

describe('dataset ZIP API', () => {
  it('rejects oversized stored objects before downloading their bytes', async () => {
    mocks.getFileMetadata.mockResolvedValue({ contentLength: 11 * 1024 * 1024 });
    await expect(
      caller.parseDatasetFile({ pathname: 'large', filename: 'large.zip' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(caller.importDatasetPackage({ pathname: 'large' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(mocks.getFileByteArray).not.toHaveBeenCalled();
    expect(mocks.importPackage).not.toHaveBeenCalled();
  });
  it('does not misclassify storage outages as user validation errors', async () => {
    mocks.getFileMetadata.mockRejectedValue(new Error('internal storage detail'));
    await expect(
      caller.parseDatasetFile({ pathname: 'file', filename: 'file.zip' }),
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
    await expect(caller.importDatasetPackage({ pathname: 'file' })).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
    });
    expect(mocks.importPackage).not.toHaveBeenCalled();
  });
  it('previews structured ZIP data without importing or consuming the upload', async () => {
    await expect(
      caller.parseDatasetFile({ pathname: 'upload-path', filename: 'examples.zip' }),
    ).resolves.toMatchObject({
      format: 'zip',
      totalCount: 1,
      datasetPackage: {
        name: 'Synthetic only',
        caseCount: 1,
        environmentCount: 1,
        mockServices: ['example'],
      },
      preview: [{ input: 'hello', expected: 'world' }],
    });
    expect(mocks.importPackage).not.toHaveBeenCalled();
    expect(mocks.releaseBestEffort).not.toHaveBeenCalled();
  });
  it('imports validated data and only then releases the successful upload', async () => {
    await expect(
      caller.importDatasetPackage({ pathname: 'upload-path', name: 'My dataset' }),
    ).resolves.toMatchObject({ datasetId: 'new-dataset' });
    expect(mocks.importPackage).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'My dataset',
        package: manifest,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(mocks.releaseBestEffort).toHaveBeenCalledWith('upload-path');
    expect(mocks.importPackage.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.releaseBestEffort.mock.invocationCallOrder[0],
    );
  });
  it('rejects malformed or unsupported packages before DB writes and retains the file', async () => {
    for (const bytes of [
      new Uint8Array([1, 2]),
      archive({ ...manifest, version: 99 }),
      archive({ ...manifest, cases: [{ ...manifest.cases[0], environmentKey: 'missing' }] }),
    ]) {
      mocks.getFileByteArray.mockResolvedValue(bytes);
      await expect(caller.importDatasetPackage({ pathname: 'upload-path' })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
    }
    expect(mocks.importPackage).not.toHaveBeenCalled();
    expect(mocks.releaseBestEffort).not.toHaveBeenCalled();
  });
  it('retains failed imports for retry and maps scope and immutable-dataset errors', async () => {
    for (const [error, code] of [
      [new AgentEvalDatasetWriteError('Not yours'), 'FORBIDDEN'],
      [new AgentEvalDatasetPackageImportError('Use a new dataset'), 'BAD_REQUEST'],
    ] as const) {
      mocks.importPackage.mockRejectedValue(error);
      await expect(
        caller.importDatasetPackage({ pathname: 'upload-path', datasetId: 'existing' }),
      ).rejects.toMatchObject({ code, message: error.message });
    }
    expect(mocks.releaseBestEffort).not.toHaveBeenCalled();
    expect(mocks.deleteFile).not.toHaveBeenCalled();
  });
  it('rejects unowned uploads before reading data or constructing an import', async () => {
    mocks.assertActiveOrLegacy.mockRejectedValue(new Error('Upload not owned'));
    await expect(caller.importDatasetPackage({ pathname: 'foreign' })).rejects.toThrow(
      'Upload not owned',
    );
    expect(mocks.getFileByteArray).not.toHaveBeenCalled();
    expect(mocks.importPackage).not.toHaveBeenCalled();
  });
  it('does not turn committed legacy imports into failures when temporary cleanup fails', async () => {
    mocks.assertActiveOrLegacy.mockResolvedValue(null);
    mocks.deleteFile.mockRejectedValue(new Error('storage unavailable'));
    await expect(caller.importDatasetPackage({ pathname: 'legacy-upload' })).resolves.toMatchObject(
      { count: 1 },
    );
  });
  it('redacts private connection URLs and credentials from the ZIP preview', async () => {
    mocks.getFileByteArray.mockResolvedValue(
      archive({
        ...manifest,
        connections: {
          privateMock: {
            credentials: { token: 'synthetic-private-token', type: 'bearer' },
            name: 'Private mock',
            url: 'https://private-mock.example/mcp',
          },
        },
        environments: [
          {
            ...manifest.environments[0],
            connectionBindings: { example: { connectionKey: 'privateMock' } },
          },
        ],
      }),
    );
    const preview = await caller.parseDatasetFile({ filename: 'private.zip', pathname: 'upload' });
    expect(preview).toMatchObject({
      datasetPackage: {
        connectionRequirements: [{ providedServices: ['example'], services: ['example'] }],
        embeddedConnections: [{ authConfigured: true, key: 'privateMock', name: 'Private mock' }],
      },
    });
    expect(JSON.stringify(preview)).not.toContain('synthetic-private-token');
    expect(JSON.stringify(preview)).not.toContain('private-mock.example');
  });
  it('refuses inaccessible existing connections before creating an import and retains the upload', async () => {
    mocks.validateBindings.mockRejectedValue(
      new EvalConnectorBindingError('The selected mock connection is unavailable'),
    );
    await expect(
      caller.importDatasetPackage({
        environmentBindings: {
          world: { example: { connectorId: 'b34a8f4d-349a-41a9-b307-3a8754e8e5a8' } },
        },
        pathname: 'upload',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mocks.importPackage).not.toHaveBeenCalled();
    expect(mocks.releaseBestEffort).not.toHaveBeenCalled();
  });
});
