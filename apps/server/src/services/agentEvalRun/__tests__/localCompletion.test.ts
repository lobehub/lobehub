import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentEvalBenchmarkModel, AgentEvalRunModel } from '@/database/models/agentEval';
import { agentEvalDatasets, agentEvalTestCases } from '@/database/schemas';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';

import { cleanupDB, serverDB, userId } from './_setup';

const mockExecAgent = vi.fn();
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(function () {
    return { execAgent: mockExecAgent };
  }),
}));

const triggerFinalizeRun = vi.fn();
vi.mock('@/server/workflows/agentEvalRun', () => ({
  AgentEvalRunWorkflow: {
    triggerFinalizeRun: (...args: unknown[]) => triggerFinalizeRun(...args),
    triggerRunThreadTrajectory: vi.fn(),
  },
}));

vi.mock('@/server/services/agentRuntime/AgentRuntimeService', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(function () {
    return { interruptOperation: vi.fn().mockResolvedValue(true) };
  }),
}));

beforeEach(async () => {
  await cleanupDB();
  mockExecAgent.mockReset();
  triggerFinalizeRun.mockReset();
});

const createSingleCaseRun = async () => {
  const benchmark = await new AgentEvalBenchmarkModel(serverDB, userId).create({
    identifier: 'bench',
    isSystem: false,
    name: 'Bench',
    rubrics: [],
  });
  const [dataset] = await serverDB
    .insert(agentEvalDatasets)
    .values({ benchmarkId: benchmark.id, identifier: 'ds', name: 'Dataset', userId })
    .returning();
  const [testCase] = await serverDB
    .insert(agentEvalTestCases)
    .values({ content: { input: 'Hello' }, datasetId: dataset.id, sortOrder: 0, userId })
    .returning();

  const service = new AgentEvalRunService(serverDB, userId);
  const run = await service.createRun({ datasetId: dataset.id });
  // startRun records the case total the completion check counts against.
  await new AgentEvalRunModel(serverDB, userId).update(run.id, {
    metrics: { averageScore: 0, failedCases: 0, passRate: 0, passedCases: 0, totalCases: 1 },
    status: 'running',
  });
  return { dataset, run, service, testCase };
};

describe('in-process trajectory completion', () => {
  it('finalizes the run once the last case completes', async () => {
    const { dataset, run, service, testCase } = await createSingleCaseRun();
    mockExecAgent.mockResolvedValue({ operationId: 'op-1' });

    await service.executeTrajectory({
      run: { datasetId: dataset.id, targetAgentId: null },
      runId: run.id,
      testCase: { content: { input: 'Hello' }, sortOrder: 0 },
      testCaseId: testCase.id,
    });

    const hook = mockExecAgent.mock.calls[0][0].hooks.find(
      (item: { id: string }) => item.id === 'eval-trajectory-complete',
    );
    await hook.handler({ reason: 'done', status: 'done' });

    expect(triggerFinalizeRun).toHaveBeenCalledWith({ runId: run.id, userId });
  });
});
