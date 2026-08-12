import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AgentEvalBenchmarkModel,
  AgentEvalRunModel,
  AgentEvalRunTopicModel,
} from '@/database/models/agentEval';
import { agentEvalDatasets, agentEvalTestCases, topics } from '@/database/schemas';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';

import { cleanupDB, serverDB, userId } from './_setup';

// Mock AiAgentService — created inside executeTrajectoryCore
const mockExecAgent = vi.fn();
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(() => ({
    execAgent: mockExecAgent,
  })),
}));

vi.mock('@/server/services/agentRuntime/AgentRuntimeService', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({
    interruptOperation: vi.fn().mockResolvedValue(true),
  })),
}));

beforeEach(async () => {
  await cleanupDB();
  mockExecAgent.mockReset();
  mockExecAgent.mockResolvedValue({ operationId: 'op-1' });
});

const setupDataset = async (cases: Array<{ caseId?: string; input: string }>) => {
  const benchmarkModel = new AgentEvalBenchmarkModel(serverDB, userId);
  const benchmark = await benchmarkModel.create({
    identifier: 'ext-benchmark',
    isSystem: false,
    name: 'External Benchmark',
    rubrics: [],
  });

  const [dataset] = await serverDB
    .insert(agentEvalDatasets)
    .values({
      benchmarkId: benchmark.id,
      identifier: 'ext-dataset',
      name: 'External Dataset',
      userId,
    })
    .returning();

  const testCases = [];
  for (const [i, c] of cases.entries()) {
    const [tc] = await serverDB
      .insert(agentEvalTestCases)
      .values({
        userId,
        content: { input: c.input },
        datasetId: dataset.id,
        metadata: c.caseId ? { caseId: c.caseId } : undefined,
        sortOrder: i + 1,
      })
      .returning();
    testCases.push(tc);
  }

  return { dataset, testCases };
};

describe('AgentEvalRunService external protocol', () => {
  describe('createRun mode=external', () => {
    it('should create a pending run with no topics or run topics', async () => {
      const { dataset } = await setupDataset([{ input: 'Q1' }, { input: 'Q2' }]);
      const service = new AgentEvalRunService(serverDB, userId);

      const run = await service.createRun({ datasetId: dataset.id, mode: 'external' });

      expect(run.status).toBe('pending');
      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
      expect(await runTopicModel.findByRunId(run.id)).toHaveLength(0);
    });

    it('should default to internal mode (idle + pre-created topics)', async () => {
      const { dataset } = await setupDataset([{ input: 'Q1' }]);
      const service = new AgentEvalRunService(serverDB, userId);

      const run = await service.createRun({ datasetId: dataset.id });

      expect(run.status).toBe('idle');
      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
      expect(await runTopicModel.findByRunId(run.id)).toHaveLength(1);
    });

    it('should reject external runs with k > 1', async () => {
      const { dataset } = await setupDataset([{ input: 'Q1' }]);
      const service = new AgentEvalRunService(serverDB, userId);

      await expect(
        service.createRun({ config: { k: 3 }, datasetId: dataset.id, mode: 'external' }),
      ).rejects.toThrow('k=1');
    });

    it('should persist caseSelection verbatim in the run config', async () => {
      const { dataset } = await setupDataset([{ input: 'Q1' }]);
      const service = new AgentEvalRunService(serverDB, userId);

      const caseSelection = { caseIds: ['case_1', 'case_2'], mode: 'include' as const };
      const run = await service.createRun({
        config: { caseSelection },
        datasetId: dataset.id,
        mode: 'external',
      });

      expect((run.config as any).caseSelection).toEqual(caseSelection);
    });

    it('should store no caseSelection key when omitted (canonical all)', async () => {
      const { dataset } = await setupDataset([{ input: 'Q1' }]);
      const service = new AgentEvalRunService(serverDB, userId);

      const run = await service.createRun({ datasetId: dataset.id, mode: 'external' });

      expect((run.config as any)?.caseSelection).toBeUndefined();
      expect('caseSelection' in ((run.config ?? {}) as object)).toBe(false);
    });
  });

  describe('createRun idempotency (caller-supplied id)', () => {
    it('should create with a caller-supplied id', async () => {
      const { dataset } = await setupDataset([{ input: 'Q1' }]);
      const service = new AgentEvalRunService(serverDB, userId);

      const run = await service.createRun({
        datasetId: dataset.id,
        id: 'run_custom_1',
        mode: 'external',
      });

      expect(run.id).toBe('run_custom_1');
    });

    it('should return the existing run when id and immutable params are equivalent', async () => {
      const { dataset } = await setupDataset([{ input: 'Q1' }]);
      const service = new AgentEvalRunService(serverDB, userId);

      const first = await service.createRun({
        config: { maxSteps: 5 },
        datasetId: dataset.id,
        id: 'run_idem_1',
        mode: 'external',
        name: 'Original',
      });
      const second = await service.createRun({
        config: { maxSteps: 5 },
        datasetId: dataset.id,
        id: 'run_idem_1',
        mode: 'external',
        name: 'Retry name differs (mutable)',
      });

      expect(second.id).toBe(first.id);
      expect(second.name).toBe('Original');
    });

    it('should throw a conflict when the same id has non-equivalent params', async () => {
      const { dataset } = await setupDataset([{ input: 'Q1' }]);
      const service = new AgentEvalRunService(serverDB, userId);

      await service.createRun({
        config: { maxSteps: 5 },
        datasetId: dataset.id,
        id: 'run_idem_2',
        mode: 'external',
      });

      await expect(
        service.createRun({
          config: { maxSteps: 9 },
          datasetId: dataset.id,
          id: 'run_idem_2',
          mode: 'external',
        }),
      ).rejects.toThrow('different create parameters');
    });

    it('should treat config key order and undefined as equivalent', async () => {
      const { dataset } = await setupDataset([{ input: 'Q1' }]);
      const service = new AgentEvalRunService(serverDB, userId);

      await service.createRun({
        config: { k: 1, maxSteps: 5 },
        datasetId: dataset.id,
        id: 'run_idem_3',
        mode: 'external',
      });
      const retry = await service.createRun({
        config: { maxSteps: 5, k: 1 },
        datasetId: dataset.id,
        id: 'run_idem_3',
        mode: 'external',
      });

      expect(retry.id).toBe('run_idem_3');
    });

    it('should persist executionMode in the run config', async () => {
      const { dataset } = await setupDataset([{ input: 'Q1' }]);
      const service = new AgentEvalRunService(serverDB, userId);

      const external = await service.createRun({ datasetId: dataset.id, mode: 'external' });
      expect((external.config as any).executionMode).toBe('external');

      const internal = await service.createRun({ datasetId: dataset.id });
      expect((internal.config as any).executionMode).toBe('internal');
    });

    it('should conflict when the same id is reused external after internal', async () => {
      const { dataset } = await setupDataset([{ input: 'Q1' }]);
      const service = new AgentEvalRunService(serverDB, userId);

      await service.createRun({ datasetId: dataset.id, id: 'run_mode_1' }); // internal (idle)

      await expect(
        service.createRun({ datasetId: dataset.id, id: 'run_mode_1', mode: 'external' }),
      ).rejects.toThrow('different create parameters');
    });

    it('should conflict when the same id is reused internal after external', async () => {
      const { dataset } = await setupDataset([{ input: 'Q1' }]);
      const service = new AgentEvalRunService(serverDB, userId);

      await service.createRun({ datasetId: dataset.id, id: 'run_mode_2', mode: 'external' });

      await expect(service.createRun({ datasetId: dataset.id, id: 'run_mode_2' })).rejects.toThrow(
        'different create parameters',
      );
    });

    it('should not infer mode from status: terminal external run still conflicts with internal reuse', async () => {
      const { dataset } = await setupDataset([{ input: 'Q1' }]);
      const service = new AgentEvalRunService(serverDB, userId);

      const run = await service.createRun({
        datasetId: dataset.id,
        id: 'run_mode_3',
        mode: 'external',
      });
      // Drive to a terminal state — status alone can no longer reveal the mode.
      const runModel = new AgentEvalRunModel(serverDB, userId);
      await runModel.update(run.id, { status: 'completed' });

      await expect(service.createRun({ datasetId: dataset.id, id: 'run_mode_3' })).rejects.toThrow(
        'different create parameters',
      );
      // ...but an equivalent external retry still returns it idempotently
      const retry = await service.createRun({
        datasetId: dataset.id,
        id: 'run_mode_3',
        mode: 'external',
      });
      expect(retry.id).toBe('run_mode_3');
      expect(retry.status).toBe('completed');
    });
  });

  describe('claimRun', () => {
    it('should claim a pending external run and return the workload', async () => {
      const { dataset } = await setupDataset([
        { caseId: 'case-a', input: 'Q1' },
        { caseId: 'case-b', input: 'Q2' },
      ]);
      const service = new AgentEvalRunService(serverDB, userId);
      const run = await service.createRun({ datasetId: dataset.id, mode: 'external' });

      const payload = await service.claimRun(run.id);

      expect(payload.run.status).toBe('running');
      expect(payload.run.startedAt).toBeDefined();
      expect(payload.dataset?.id).toBe(dataset.id);
      expect(payload.testCases).toHaveLength(2);
      expect(payload.testCases.map((t) => (t.metadata as any)?.caseId)).toEqual([
        'case-a',
        'case-b',
      ]);
    });

    it('should throw when the run is not pending (double claim)', async () => {
      const { dataset } = await setupDataset([{ input: 'Q1' }]);
      const service = new AgentEvalRunService(serverDB, userId);
      const run = await service.createRun({ datasetId: dataset.id, mode: 'external' });

      await service.claimRun(run.id);
      await expect(service.claimRun(run.id)).rejects.toThrow('not pending');
    });

    it('should return caseSelection unchanged in the claim payload', async () => {
      const { dataset } = await setupDataset([{ caseId: 'case-a', input: 'Q1' }]);
      const service = new AgentEvalRunService(serverDB, userId);
      const caseSelection = { caseIds: ['case-a'], mode: 'include' as const };
      const run = await service.createRun({
        config: { caseSelection },
        datasetId: dataset.id,
        mode: 'external',
      });

      const payload = await service.claimRun(run.id);

      expect((payload.run.config as any).caseSelection).toEqual(caseSelection);
    });
  });

  describe('executeTrajectoryOnDemand', () => {
    it('should resolve metadata.caseId, create topic/runTopic on demand, and start the agent', async () => {
      const { dataset, testCases } = await setupDataset([{ caseId: 'case-x', input: 'Q1' }]);
      const service = new AgentEvalRunService(serverDB, userId);
      const run = await service.createRun({ datasetId: dataset.id, mode: 'external' });
      await service.claimRun(run.id);

      const result = await service.executeTrajectoryOnDemand({ caseId: 'case-x', runId: run.id });

      expect(result.testCaseId).toBe(testCases[0].id);
      expect(result.topicId).toBeTruthy();
      expect(mockExecAgent).toHaveBeenCalledOnce();

      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
      const runTopics = await runTopicModel.findByRunId(run.id);
      expect(runTopics).toHaveLength(1);
      expect(runTopics[0].status).toBe('running');

      const [topic] = await serverDB.select().from(topics).where(eq(topics.id, result.topicId!));
      expect(topic.trigger).toBe('eval');
    });

    it('should return the execAgent operationId', async () => {
      const { dataset } = await setupDataset([{ caseId: 'case-op', input: 'Q1' }]);
      const service = new AgentEvalRunService(serverDB, userId);
      const run = await service.createRun({ datasetId: dataset.id, mode: 'external' });
      await service.claimRun(run.id);

      const result = await service.executeTrajectoryOnDemand({ caseId: 'case-op', runId: run.id });

      expect(result.operationId).toBe('op-1');
      expect(mockExecAgent).toHaveBeenCalledWith(expect.objectContaining({ queueRetries: 5 }));
    });

    it('should pass deviceId through to execAgent', async () => {
      const { dataset } = await setupDataset([{ caseId: 'case-dev', input: 'Q1' }]);
      const service = new AgentEvalRunService(serverDB, userId);
      const run = await service.createRun({ datasetId: dataset.id, mode: 'external' });
      await service.claimRun(run.id);

      await service.executeTrajectoryOnDemand({
        caseId: 'case-dev',
        deviceId: 'device-123',
        runId: run.id,
      });

      expect(mockExecAgent).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: 'device-123' }),
      );
    });

    it('should not pass deviceId when omitted', async () => {
      const { dataset } = await setupDataset([{ caseId: 'case-nodev', input: 'Q1' }]);
      const service = new AgentEvalRunService(serverDB, userId);
      const run = await service.createRun({ datasetId: dataset.id, mode: 'external' });
      await service.claimRun(run.id);

      await service.executeTrajectoryOnDemand({ caseId: 'case-nodev', runId: run.id });

      const callArgs = mockExecAgent.mock.calls[0][0];
      expect('deviceId' in callArgs).toBe(false);
    });

    it('should fall back to the internal test case id', async () => {
      const { dataset, testCases } = await setupDataset([{ input: 'Q1' }]);
      const service = new AgentEvalRunService(serverDB, userId);
      const run = await service.createRun({ datasetId: dataset.id, mode: 'external' });
      await service.claimRun(run.id);

      const result = await service.executeTrajectoryOnDemand({
        caseId: testCases[0].id,
        runId: run.id,
      });
      expect(result.testCaseId).toBe(testCases[0].id);
    });

    it('should throw when the run has not been claimed', async () => {
      const { dataset } = await setupDataset([{ caseId: 'c1', input: 'Q1' }]);
      const service = new AgentEvalRunService(serverDB, userId);
      const run = await service.createRun({ datasetId: dataset.id, mode: 'external' });

      await expect(
        service.executeTrajectoryOnDemand({ caseId: 'c1', runId: run.id }),
      ).rejects.toThrow('not running');
    });

    it('should throw for an unknown caseId', async () => {
      const { dataset } = await setupDataset([{ caseId: 'c1', input: 'Q1' }]);
      const service = new AgentEvalRunService(serverDB, userId);
      const run = await service.createRun({ datasetId: dataset.id, mode: 'external' });
      await service.claimRun(run.id);

      await expect(
        service.executeTrajectoryOnDemand({ caseId: 'nope', runId: run.id }),
      ).rejects.toThrow('Test case not found');
    });

    it('should reject re-executing an active case', async () => {
      const { dataset } = await setupDataset([{ caseId: 'c1', input: 'Q1' }]);
      const service = new AgentEvalRunService(serverDB, userId);
      const run = await service.createRun({ datasetId: dataset.id, mode: 'external' });
      await service.claimRun(run.id);
      await service.executeTrajectoryOnDemand({ caseId: 'c1', runId: run.id });

      await expect(
        service.executeTrajectoryOnDemand({ caseId: 'c1', runId: run.id }),
      ).rejects.toThrow('already active');
    });

    it('should idempotently re-link a terminal case to a fresh topic (old topic preserved)', async () => {
      const { dataset, testCases } = await setupDataset([{ caseId: 'c1', input: 'Q1' }]);
      const service = new AgentEvalRunService(serverDB, userId);
      const run = await service.createRun({ datasetId: dataset.id, mode: 'external' });
      await service.claimRun(run.id);

      const first = await service.executeTrajectoryOnDemand({ caseId: 'c1', runId: run.id });

      // Mark terminal
      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
      await runTopicModel.updateByRunAndTopic(run.id, first.topicId!, { status: 'passed' });

      const second = await service.executeTrajectoryOnDemand({ caseId: 'c1', runId: run.id });

      expect(second.topicId).not.toBe(first.topicId);
      expect(second.testCaseId).toBe(testCases[0].id);

      // Still exactly one RunTopic for this (run, testCase)
      const runTopics = await runTopicModel.findByRunId(run.id);
      expect(runTopics).toHaveLength(1);

      // Old topic preserved
      const [oldTopic] = await serverDB.select().from(topics).where(eq(topics.id, first.topicId!));
      expect(oldTopic).toBeDefined();
    });
  });

  describe('abortRun', () => {
    it('should abort an external run with no run topics', async () => {
      const { dataset } = await setupDataset([{ input: 'Q1' }]);
      const service = new AgentEvalRunService(serverDB, userId);
      const run = await service.createRun({ datasetId: dataset.id, mode: 'external' });
      await service.claimRun(run.id);

      await service.abortRun(run.id);

      const updated = await service['runModel'].findById(run.id);
      expect(updated?.status).toBe('aborted');
    });
  });

  describe('evaluateAndFinalizeRun expectedTotalCases', () => {
    it('should use expectedTotalCases as the denominator for external runs', async () => {
      const service = new AgentEvalRunService(serverDB, userId);

      const metrics = await service.evaluateAndFinalizeRun({
        expectedTotalCases: 10,
        run: { config: null, id: 'r1' },
        runTopics: [
          { runId: 'r1', score: 1, status: 'passed', topicId: 't1' },
          { runId: 'r1', score: 0, status: 'failed', topicId: 't2' },
        ],
      });

      expect(metrics.totalCases).toBe(10);
      expect(metrics.completedCases).toBe(2);
      expect(metrics.passRate).toBeCloseTo(0.1);
    });
  });
});
