// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentEvalDatasetWriteError } from '@/database/models/agentEval/datasetAccess';
import { AgentEvalEnvironmentBindingError } from '@/database/models/agentEval/environment';
import { createCallerFactory } from '@/libs/trpc/lambda';
import { EvalConnectorBindingError } from '@/server/services/agentEvalConnector';

import { datasetRouter } from './datasets';
import { environmentRouter } from './environments';
import { testCaseRouter } from './testCases';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  batchCreate: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  createDataset: vi.fn(),
  updateDataset: vi.fn(),
  validateBindings: vi.fn(),
  createEnvironment: vi.fn(),
  updateEnvironment: vi.fn(),
  findEnvironment: vi.fn(),
}));

vi.mock('./procedures', async () => {
  const { publicProcedure } = await import('@/libs/trpc/lambda');
  const procedure = publicProcedure.use((opts) =>
    opts.next({
      ctx: {
        evalConnectorServiceForDataset: () => ({ validateBindings: mocks.validateBindings }),
        environmentModel: {
          create: mocks.createEnvironment,
          findById: mocks.findEnvironment,
          update: mocks.updateEnvironment,
        },
        datasetModel: { create: mocks.createDataset, update: mocks.updateDataset },
        testCaseModel: {
          findById: vi.fn().mockResolvedValue({ datasetId: 'dataset' }),
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
const environments = createCallerFactory(environmentRouter)({} as any);

beforeEach(() => {
  vi.resetAllMocks();
  for (const mock of Object.values(mocks)) {
    mock.mockRejectedValue(new AgentEvalDatasetWriteError());
  }
  mocks.validateBindings.mockResolvedValue(undefined);
  mocks.findEnvironment.mockResolvedValue({ config: {} });
});

describe('mock connection write access', () => {
  it('leaves omitted bindings for the atomic model merge and accepts explicit unchanged bindings', async () => {
    const connectorBindings = { mock: { connectorId: '5d9f523a-7180-4d3e-9242-906abc41a612' } };
    mocks.findEnvironment.mockResolvedValue({ config: { connectorBindings } });
    mocks.updateEnvironment.mockResolvedValue({ id: 'env' });
    await environments.updateEnvironment({ config: { timezone: 'UTC' }, id: 'env' });
    expect(mocks.updateEnvironment).toHaveBeenCalledWith('env', {
      config: { timezone: 'UTC' },
    });
    expect(mocks.findEnvironment).not.toHaveBeenCalled();
    await environments.updateEnvironment({ config: { connectorBindings }, id: 'env' });
    expect(mocks.updateEnvironment).toHaveBeenCalledTimes(2);
    // JSONB ordering and an explicit default transport do not change the binding.
    await environments.updateEnvironment({
      config: { connectorBindings: { mock: { transport: 'mcp', ...connectorBindings.mock } } },
      id: 'env',
    });
    expect(mocks.updateEnvironment).toHaveBeenCalledTimes(3);
    await expect(
      environments.updateEnvironment({ config: { connectorBindings: {} }, id: 'env' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mocks.updateEnvironment).toHaveBeenCalledTimes(3);
  });

  it('reports a concurrent Dataset binding repair as a conflict', async () => {
    const connectorBindings = { mock: { connectorId: '5d9f523a-7180-4d3e-9242-906abc41a612' } };
    mocks.findEnvironment.mockResolvedValue({ config: { connectorBindings } });
    mocks.updateEnvironment.mockRejectedValue(new AgentEvalEnvironmentBindingError());
    await expect(
      environments.updateEnvironment({ config: { connectorBindings }, id: 'env' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects inaccessible bindings on every direct environment or case write path', async () => {
    const environment = {
      connectorBindings: { mock: { connectorId: '5d9f523a-7180-4d3e-9242-906abc41a612' } },
      mock: { services: ['mock'] },
    };
    const content = { environment, input: 'Test' };
    mocks.validateBindings.mockRejectedValue(
      new EvalConnectorBindingError('The selected mock connection is unavailable'),
    );
    for (const request of [
      () => environments.createEnvironment({ config: environment, name: 'Mock environment' }),
      () => environments.updateEnvironment({ config: environment, id: 'env' }),
      () => cases.createTestCase({ content, datasetId: 'dataset' }),
      () => cases.batchCreateTestCases({ cases: [{ content }], datasetId: 'dataset' }),
      () => cases.updateTestCase({ content, id: 'case' }),
      () => datasets.createDataset({ cases: [{ content }], identifier: 'copy', name: 'Copy' }),
    ]) {
      await expect(request()).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    }
    for (const write of [
      mocks.createEnvironment,
      mocks.updateEnvironment,
      mocks.create,
      mocks.batchCreate,
      mocks.update,
      mocks.createDataset,
    ]) {
      expect(write).not.toHaveBeenCalled();
    }
  });
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
