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
  it('promotes an external error while keeping a partially executed run running', async () => {
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
    const error = { message: 'Agent execution timed out', type: 'AgentTimeoutError' };
    const erroredTopic = {
      evalResult: { awaitingExternalEval: false },
      passed: false,
      score: 0,
      status: 'error',
      topicId: 'topic-1',
    };

    mocks.findRunById.mockResolvedValue(run);
    mocks.findRunTopics
      .mockResolvedValueOnce([awaitingTopic])
      .mockResolvedValueOnce([erroredTopic]);
    mocks.countByDatasetId.mockResolvedValue(10);
    mocks.evaluateAndFinalizeRun.mockResolvedValue({
      completedCases: 1,
      errorCases: 1,
      timeoutCases: 0,
      totalCases: 10,
    });
    mocks.updateRun.mockResolvedValue({ ...run, status: 'running' });

    const result = await caller().reportResult({
      correct: false,
      result: { error },
      runId: run.id,
      score: 0,
      topicId: awaitingTopic.topicId,
    });

    expect(mocks.updateRunTopic).toHaveBeenCalledWith(
      run.id,
      awaitingTopic.topicId,
      expect.objectContaining({
        evalResult: expect.objectContaining({
          error: 'AgentTimeoutError: Agent execution timed out',
          errorDetail: error,
          externalResult: { error },
        }),
        status: 'error',
      }),
    );
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

  it.each(['pending', 'running'] as const)(
    'keeps the run running while another topic is still %s',
    async (activeStatus) => {
      const run = {
        config: { caseSelection: { caseIds: ['c1', 'c2'], mode: 'include' }, k: 1 },
        datasetId: 'dataset-1',
        id: 'run-1',
        metrics: null,
        startedAt: new Date(),
      };
      const reportingTopic = {
        evalResult: { awaitingExternalEval: true },
        status: 'external',
        topicId: 'topic-1',
      };
      const passedTopic = {
        evalResult: { awaitingExternalEval: false },
        passed: true,
        score: 1,
        status: 'passed',
        topicId: 'topic-1',
      };
      const activeTopic = { status: activeStatus, topicId: 'topic-2' };

      mocks.findRunById.mockResolvedValue(run);
      mocks.findRunTopics
        .mockResolvedValueOnce([reportingTopic, activeTopic])
        .mockResolvedValueOnce([passedTopic, activeTopic]);
      mocks.countByDatasetId.mockResolvedValue(2);
      mocks.evaluateAndFinalizeRun.mockResolvedValue({
        completedCases: 2,
        errorCases: 0,
        timeoutCases: 0,
        totalCases: 2,
      });
      mocks.updateRun.mockResolvedValue({ ...run, status: 'running' });

      const result = await caller().reportResult({
        correct: true,
        runId: run.id,
        score: 1,
        topicId: reportingTopic.topicId,
      });

      expect(result.runStatus).toBe('running');
      expect(mocks.updateRun).toHaveBeenCalledWith(
        run.id,
        expect.objectContaining({ status: 'running' }),
      );
    },
  );
});

describe('agentEvalExternalRouter.runSetStatus', () => {
  it('sets an existing run to running', async () => {
    mocks.findRunById.mockResolvedValue({ id: 'run-1', status: 'external' });
    mocks.updateRun.mockResolvedValue({ id: 'run-1', status: 'running' });

    const result = await caller().runSetStatus({ runId: 'run-1', status: 'running' });

    expect(mocks.updateRun).toHaveBeenCalledWith('run-1', { status: 'running' });
    expect(mocks.evaluateAndFinalizeRun).not.toHaveBeenCalled();
    expect(result).toEqual({ runId: 'run-1', status: 'running', success: true });
  });
});
