import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStepRunner } from '@/server/workflows/testing/stepContext';

import { runBenchmarkHandler } from '../runBenchmark';

const mocks = vi.hoisted(() => ({
  filterTestCasesNeedingExecution: vi.fn(),
  findByDatasetId: vi.fn(),
  findSummaryById: vi.fn(),
  finalize: vi.fn(),
  triggerPaginateTestCases: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/database/server', () => ({ getServerDB: vi.fn().mockResolvedValue({}) }));
vi.mock('@/database/models/agentEval', () => ({
  AgentEvalRunModel: class {
    findSummaryById = mocks.findSummaryById;
    finalize = mocks.finalize;
    update = mocks.update;
  },
  // A fresh run has no RunTopic yet: nothing is counted before it starts.
  AgentEvalRunTopicModel: class {
    findByRunId = async () => [];
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

  it('settles a previously created empty internal run with a generation-guarded failure', async () => {
    const startedAt = new Date('2026-11-01T12:00:00Z');
    mocks.findSummaryById.mockResolvedValue({
      config: { caseSelection: { caseIds: ['a', 'b', 'c'], mode: 'exclude' } },
      datasetId: 'ds-1',
      startedAt,
      status: 'pending',
    });

    expect(await runBenchmarkHandler(context({}))).toMatchObject({
      success: false,
      totalTestCases: 0,
    });
    expect(mocks.finalize).toHaveBeenCalledWith(
      'run-1',
      { status: 'failed' },
      { startedAt: startedAt.toISOString() },
    );
    expect(mocks.triggerPaginateTestCases).not.toHaveBeenCalled();
  });

  it.each([{ dryRun: true }, { external: true }])(
    'does not settle empty dry or external runs (%j)',
    async ({ dryRun, external }) => {
      mocks.findSummaryById.mockResolvedValue({
        config: { executionMode: external ? 'external' : 'internal' },
        datasetId: 'ds-1',
        status: 'pending',
      });
      mocks.findByDatasetId.mockResolvedValue([]);
      await runBenchmarkHandler(context({ dryRun }));
      expect(mocks.finalize).not.toHaveBeenCalled();
    },
  );

  it('counts only the cases the run selected as totalCases', async () => {
    mocks.findSummaryById.mockResolvedValue({
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
    mocks.findSummaryById.mockResolvedValue({ config: {}, datasetId: 'ds-1', status: 'idle' });

    const result = await runBenchmarkHandler(context({}));

    expect(result).toMatchObject({ success: true, totalTestCases: 3 });
    expect(mocks.update).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ metrics: expect.objectContaining({ totalCases: 3 }) }),
    );
  });
});
