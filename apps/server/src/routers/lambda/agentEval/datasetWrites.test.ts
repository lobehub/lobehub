// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentEvalDatasetWriteError } from '@/database/models/agentEval/datasetAccess';
import { createCallerFactory } from '@/libs/trpc/lambda';

import { datasetRouter } from './datasets';
import { testCaseRouter } from './testCases';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  batchCreate: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  createDataset: vi.fn(),
  updateDataset: vi.fn(),
}));

vi.mock('./procedures', async () => {
  const { publicProcedure } = await import('@/libs/trpc/lambda');
  const procedure = publicProcedure.use((opts) =>
    opts.next({
      ctx: {
        datasetModel: { create: mocks.createDataset, update: mocks.updateDataset },
        testCaseModel: {
          create: mocks.create,
          batchCreate: mocks.batchCreate,
          update: mocks.update,
          delete: mocks.delete,
        },
      } as any,
    }),
  );
  return { agentEvalProcedure: procedure, agentEvalProcedureWrite: procedure };
});

const datasets = createCallerFactory(datasetRouter)({} as any);
const cases = createCallerFactory(testCaseRouter)({} as any);

beforeEach(() => {
  vi.resetAllMocks();
  for (const mock of Object.values(mocks)) {
    mock.mockRejectedValue(new AgentEvalDatasetWriteError());
  }
});

describe('dataset write failures', () => {
  it('returns permission errors for rejected case writes, not internal errors', async () => {
    await expect(
      cases.createTestCase({ content: { input: 'Case' }, datasetId: 'blocked' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      cases.batchCreateTestCases({ cases: [{ content: { input: 'Case' } }], datasetId: 'blocked' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      cases.updateTestCase({ content: { input: 'Changed' }, id: 'fixed-case' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('reports a frozen case deletion as unsuccessful using the existing response shape', async () => {
    await expect(cases.deleteTestCase({ id: 'fixed-case' })).resolves.toMatchObject({
      success: false,
    });
  });

  it('returns permission errors for frozen dataset updates and unreadable copied environments', async () => {
    await expect(datasets.updateDataset({ id: 'fixed', metadata: {} })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      datasets.createDataset({
        cases: [{ content: { input: 'Copy' }, environmentId: 'foreign' }],
        identifier: 'copy',
        name: 'Copy',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
