// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agentEvalExternalRouter } from './agentEvalExternal';

const mocks = vi.hoisted(() => ({
  countByDatasetId: vi.fn(),
  evaluateAndFinalizeRun: vi.fn(),
  findRunById: vi.fn(),
  findRunTopics: vi.fn(),
  updateRun: vi.fn(),
  updateRunTopic: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => ({})) }));

vi.mock('@/database/models/agentEval', () => ({
  AgentEvalDatasetModel: vi.fn().mockImplementation(() => ({})),
  AgentEvalRunModel: vi.fn().mockImplementation(() => ({
    findById: mocks.findRunById,
    update: mocks.updateRun,
  })),
  AgentEvalRunTopicModel: vi.fn().mockImplementation(() => ({
    findByRunId: mocks.findRunTopics,
    updateByRunAndTopic: mocks.updateRunTopic,
  })),
  AgentEvalTestCaseModel: vi.fn().mockImplementation(() => ({
    countByDatasetId: mocks.countByDatasetId,
  })),
}));

vi.mock('@/database/models/thread', () => ({
  ThreadModel: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@/server/services/agentEvalRun', () => ({
  AgentEvalRunService: vi.fn().mockImplementation(() => ({
    evaluateAndFinalizeRun: mocks.evaluateAndFinalizeRun,
  })),
  RUN_CREATE_ID_CONFLICT: 'RUN_CREATE_ID_CONFLICT',
}));

const caller = () => agentEvalExternalRouter.createCaller({ userId: 'user-1' } as never);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('agentEvalExternalRouter.reportResult', () => {
  it('keeps a partially executed multi-case run running', async () => {
    const run = {
      config: { k: 1 },
      datasetId: 'dataset-1',
      id: 'run-1',
      metrics: null,
      startedAt: new Date(),
    };
    const awaitingTopic = {
      evalResult: { awaitingExternalEval: true },
      status: 'external',
      topicId: 'topic-1',
    };
    const completedTopic = {
      evalResult: { awaitingExternalEval: false },
      passed: true,
      score: 1,
      status: 'passed',
      topicId: 'topic-1',
    };

    mocks.findRunById.mockResolvedValue(run);
    mocks.findRunTopics
      .mockResolvedValueOnce([awaitingTopic])
      .mockResolvedValueOnce([completedTopic]);
    mocks.countByDatasetId.mockResolvedValue(10);
    mocks.evaluateAndFinalizeRun.mockResolvedValue({
      completedCases: 1,
      errorCases: 0,
      timeoutCases: 0,
      totalCases: 10,
    });
    mocks.updateRun.mockResolvedValue({ ...run, status: 'running' });

    const result = await caller().reportResult({
      correct: true,
      runId: run.id,
      score: 1,
      topicId: awaitingTopic.topicId,
    });

    expect(result.runStatus).toBe('running');
    expect(mocks.updateRun).toHaveBeenCalledWith(
      run.id,
      expect.objectContaining({ status: 'running' }),
    );
  });

  it('uses the caseSelection subset as the total-cases denominator', async () => {
    const run = {
      config: { caseSelection: { caseIds: ['c1'], mode: 'include' }, k: 1 },
      datasetId: 'dataset-1',
      id: 'run-1',
      metrics: null,
      startedAt: new Date(),
    };
    const passedTopic = {
      evalResult: { awaitingExternalEval: false },
      passed: true,
      score: 1,
      status: 'passed',
      topicId: 'topic-1',
    };

    mocks.findRunById.mockResolvedValue(run);
    mocks.findRunTopics.mockResolvedValueOnce([passedTopic]).mockResolvedValueOnce([passedTopic]);
    mocks.countByDatasetId.mockResolvedValue(10);
    mocks.evaluateAndFinalizeRun.mockResolvedValue({
      completedCases: 1,
      errorCases: 0,
      timeoutCases: 0,
      totalCases: 1,
    });
    mocks.updateRun.mockResolvedValue({ ...run, status: 'completed' });

    const result = await caller().reportResult({
      correct: true,
      runId: run.id,
      score: 1,
      topicId: passedTopic.topicId,
    });

    // The denominator comes from the selection (1 selected case), not the
    // full dataset count (10) — so reporting the only selected case completes
    // the run instead of leaving it running forever.
    expect(mocks.evaluateAndFinalizeRun).toHaveBeenCalledWith(
      expect.objectContaining({ expectedTotalCases: 1 }),
    );
    expect(result.runStatus).toBe('completed');
  });
});
