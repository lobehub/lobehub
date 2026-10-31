import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStepRunner } from '@/server/workflows/testing/stepContext';

import { runBenchmarkHandler } from '../runBenchmark';

const mocks = vi.hoisted(() => ({
  filterTestCasesNeedingExecution: vi.fn(),
  findByDatasetId: vi.fn(),
  findById: vi.fn(),
  triggerPaginateTestCases: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/database/server', () => ({ getServerDB: vi.fn().mockResolvedValue({}) }));
vi.mock('@/database/models/agentEval', () => ({
  AgentEvalRunModel: class {
    findById = mocks.findById;
    update = mocks.update;
  },
  AgentEvalTestCaseModel: class {
    findByDatasetId = mocks.findByDatasetId;
  },
}));
vi.mock('@/server/workflows/agentEvalRun', () => ({
  AgentEvalRunWorkflow: {
    filterTestCasesNeedingExecution: mocks.filterTestCasesNeedingExecution,
    triggerPaginateTestCases: mocks.triggerPaginateTestCases,
  },
}));
vi.mock('@/server/workflows/agentEvalRun/utils', () => ({
  resolveAgentEvalRunWorkspace: vi.fn().mockResolvedValue(undefined),
}));

const cases = ['a', 'b', 'c'].map((caseId) => ({ id: `case-${caseId}`, metadata: { caseId } }));

const context = (payload: Record<string, unknown>) =>
  ({
    requestPayload: { runId: 'run-1', userId: 'u1', ...payload },
    run: createStepRunner(),
  }) as any;

describe('runBenchmarkHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findByDatasetId.mockResolvedValue(cases);
    // Every case the run owns still has a pending topic.
    mocks.filterTestCasesNeedingExecution.mockImplementation(
      async (_db, { testCaseIds }) => testCaseIds,
    );
  });

  it('counts only the cases the run selected as totalCases', async () => {
    mocks.findById.mockResolvedValue({
      config: { caseSelection: { caseIds: ['b'], mode: 'include' } },
      datasetId: 'ds-1',
      status: 'idle',
    });

    const result = await runBenchmarkHandler(context({}));

    expect(result).toMatchObject({ success: true, toExecute: 1, totalTestCases: 1 });
    expect(mocks.filterTestCasesNeedingExecution).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ testCaseIds: ['case-b'] }),
    );
    expect(mocks.update).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        metrics: expect.objectContaining({ totalCases: 1 }),
        status: 'running',
      }),
    );
    expect(mocks.triggerPaginateTestCases).toHaveBeenCalledWith({ runId: 'run-1', userId: 'u1' });
  });

  it('counts the whole dataset when the run has no case selection', async () => {
    mocks.findById.mockResolvedValue({ config: {}, datasetId: 'ds-1', status: 'idle' });

    const result = await runBenchmarkHandler(context({}));

    expect(result).toMatchObject({ success: true, totalTestCases: 3 });
    expect(mocks.update).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ metrics: expect.objectContaining({ totalCases: 3 }) }),
    );
  });
});
