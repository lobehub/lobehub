import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { AgentEvalBenchmarkModel, AgentEvalRunTopicModel } from '@/database/models/agentEval';
import {
  agentEvalBenchmarks,
  agentEvalDatasets,
  agentEvalRuns,
  agentEvalRunTopics,
  agentEvalTestCases,
  messages,
  topics,
  users,
} from '@/database/schemas';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';

// Mock AiAgentService — created inside executeTrajectory
const mockExecAgent = vi.fn();
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(() => ({
    execAgent: mockExecAgent,
  })),
}));

// Mock appEnv so APP_URL is deterministic
vi.mock('@/envs/app', () => ({
  appEnv: { APP_URL: 'https://test.example.com' },
}));

// Mock AgentRuntimeService (required by service constructor path for checkAndHandleRunTimeout)
vi.mock('@/server/services/agentRuntime/AgentRuntimeService', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({
    interruptOperation: vi.fn().mockResolvedValue(true),
  })),
}));

const serverDB = await getTestDB();
const userId = 'trajectory-test-user';

beforeEach(async () => {
  await serverDB.delete(messages);
  await serverDB.delete(agentEvalRunTopics);
  await serverDB.delete(agentEvalRuns);
  await serverDB.delete(agentEvalTestCases);
  await serverDB.delete(agentEvalDatasets);
  await serverDB.delete(agentEvalBenchmarks);
  await serverDB.delete(topics);
  await serverDB.delete(users);

  await serverDB.insert(users).values({ id: userId });

  mockExecAgent.mockReset();
});

/**
 * Helper: create benchmark → dataset → testCase → run (minimal chain for loadTrajectoryData tests)
 */
async function setupTrajectoryChain(opts?: {
  envPrompt?: string;
  input?: string;
  sortOrder?: number;
  targetAgentId?: string | null;
}) {
  const benchmarkModel = new AgentEvalBenchmarkModel(serverDB, userId);
  const benchmark = await benchmarkModel.create({
    identifier: 'traj-benchmark',
    isSystem: false,
    name: 'Trajectory Benchmark',
    rubrics: [],
  });

  const [dataset] = await serverDB
    .insert(agentEvalDatasets)
    .values({
      benchmarkId: benchmark.id,
      evalConfig: opts?.envPrompt ? { envPrompt: opts.envPrompt } : undefined,
      identifier: 'traj-dataset',
      name: 'Trajectory Dataset',
      userId,
    })
    .returning();

  const [testCase] = await serverDB
    .insert(agentEvalTestCases)
    .values({
      content: { expected: '42', input: opts?.input ?? 'What is 6*7?' },
      datasetId: dataset.id,
      sortOrder: opts?.sortOrder ?? 1,
      userId,
    })
    .returning();

  const service = new AgentEvalRunService(serverDB, userId);
  const run = await service.createRun({
    datasetId: dataset.id,
    name: 'Trajectory Run',
    targetAgentId: opts?.targetAgentId ?? undefined,
  });

  return { benchmark, dataset, run, testCase };
}

describe('AgentEvalRunService', () => {
  // ─── loadTrajectoryData ─────────────────────────────────────────────
  describe('loadTrajectoryData', () => {
    it('should return run, testCase, and envPrompt when all exist', async () => {
      const { run, testCase } = await setupTrajectoryChain({ envPrompt: 'You are a math tutor.' });

      const service = new AgentEvalRunService(serverDB, userId);
      const data = await service.loadTrajectoryData(run.id, testCase.id);

      expect('error' in data).toBe(false);
      if (!('error' in data)) {
        expect(data.run.id).toBe(run.id);
        expect(data.testCase.id).toBe(testCase.id);
        expect(data.envPrompt).toBe('You are a math tutor.');
      }
    });

    it('should return undefined envPrompt when dataset has no envPrompt', async () => {
      const { run, testCase } = await setupTrajectoryChain();

      const service = new AgentEvalRunService(serverDB, userId);
      const data = await service.loadTrajectoryData(run.id, testCase.id);

      expect('error' in data).toBe(false);
      if (!('error' in data)) {
        expect(data.envPrompt).toBeUndefined();
      }
    });

    it('should return error when run not found', async () => {
      const { testCase } = await setupTrajectoryChain();

      const service = new AgentEvalRunService(serverDB, userId);
      const data = await service.loadTrajectoryData('non-existent-run-id', testCase.id);

      expect(data).toEqual({ error: 'Run not found' });
    });

    it('should return error when test case not found', async () => {
      const { run } = await setupTrajectoryChain();

      const service = new AgentEvalRunService(serverDB, userId);
      const data = await service.loadTrajectoryData(run.id, 'non-existent-test-case-id');

      expect(data).toEqual({ error: 'Test case not found' });
    });
  });

  // ─── executeTrajectory ──────────────────────────────────────────────
  describe('executeTrajectory', () => {
    it('should create topic and runTopic, call execAgent, and store operationId on success', async () => {
      const { run, testCase } = await setupTrajectoryChain({ input: 'Hello world' });

      mockExecAgent.mockResolvedValue({ operationId: 'op-123' });

      const service = new AgentEvalRunService(serverDB, userId);
      const result = await service.executeTrajectory({
        run: { datasetId: run.datasetId, targetAgentId: null },
        runId: run.id,
        testCase: { content: { input: 'Hello world' }, sortOrder: testCase.sortOrder },
        testCaseId: testCase.id,
      });

      // Should return topicId without error
      expect(result).toHaveProperty('topicId');
      expect(result).not.toHaveProperty('error');

      // Verify topic was created
      const allTopics = await serverDB.select().from(topics);
      const evalTopic = allTopics.find((t) => t.id === result.topicId);
      expect(evalTopic).toBeDefined();
      expect(evalTopic?.trigger).toBe('eval');
      expect(evalTopic?.title).toContain('[Eval Case #');

      // Verify runTopic was created with 'running' status
      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
      const runTopic = await runTopicModel.findByRunAndTestCase(run.id, testCase.id);
      expect(runTopic).toBeDefined();
      expect(runTopic?.topicId).toBe(result.topicId);

      // Verify operationId was stored in evalResult
      expect(runTopic?.evalResult).toMatchObject({
        operationId: 'op-123',
        rubricScores: [],
      });

      // Verify execAgent was called with correct params
      expect(mockExecAgent).toHaveBeenCalledTimes(1);
      expect(mockExecAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          autoStart: true,
          completionWebhook: {
            body: { runId: run.id, testCaseId: testCase.id, userId },
            url: 'https://test.example.com/api/workflows/agent-eval-run/on-trajectory-complete',
          },
          prompt: 'Hello world',
          userInterventionConfig: { approvalMode: 'headless' },
        }),
      );
    });

    it('should pass envPrompt as evalContext when provided', async () => {
      const { run, testCase } = await setupTrajectoryChain();

      mockExecAgent.mockResolvedValue({ operationId: 'op-456' });

      const service = new AgentEvalRunService(serverDB, userId);
      await service.executeTrajectory({
        envPrompt: 'You are a math tutor.',
        run: { datasetId: run.datasetId, targetAgentId: null },
        runId: run.id,
        testCase: { content: { input: 'What is 6*7?' }, sortOrder: 1 },
        testCaseId: testCase.id,
      });

      expect(mockExecAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          evalContext: { envPrompt: 'You are a math tutor.' },
        }),
      );
    });

    it('should not include evalContext when envPrompt is undefined', async () => {
      const { run, testCase } = await setupTrajectoryChain();

      mockExecAgent.mockResolvedValue({});

      const service = new AgentEvalRunService(serverDB, userId);
      await service.executeTrajectory({
        run: { datasetId: run.datasetId, targetAgentId: null },
        runId: run.id,
        testCase: { content: { input: 'test' }, sortOrder: 1 },
        testCaseId: testCase.id,
      });

      const callArgs = mockExecAgent.mock.calls[0][0];
      expect(callArgs).not.toHaveProperty('evalContext');
    });

    it('should handle execAgent returning no operationId', async () => {
      const { run, testCase } = await setupTrajectoryChain();

      mockExecAgent.mockResolvedValue({}); // no operationId

      const service = new AgentEvalRunService(serverDB, userId);
      const result = await service.executeTrajectory({
        run: { datasetId: run.datasetId, targetAgentId: null },
        runId: run.id,
        testCase: { content: { input: 'test' }, sortOrder: 1 },
        testCaseId: testCase.id,
      });

      expect(result).toHaveProperty('topicId');
      expect(result).not.toHaveProperty('error');

      // RunTopic should exist but evalResult should not have operationId stored
      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
      const runTopic = await runTopicModel.findByRunAndTestCase(run.id, testCase.id);
      expect(runTopic?.evalResult?.operationId).toBeUndefined();
    });

    it('should mark runTopic as error and return error when execAgent throws', async () => {
      const { run, testCase } = await setupTrajectoryChain();

      mockExecAgent.mockRejectedValue(new Error('Connection refused'));

      const service = new AgentEvalRunService(serverDB, userId);
      const result = await service.executeTrajectory({
        run: { datasetId: run.datasetId, targetAgentId: null },
        runId: run.id,
        testCase: { content: { input: 'test' }, sortOrder: 1 },
        testCaseId: testCase.id,
      });

      // Should return error and topicId
      expect(result).toHaveProperty('error', 'Connection refused');
      expect(result).toHaveProperty('topicId');

      // RunTopic should be marked as error
      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
      const runTopic = await runTopicModel.findByRunAndTestCase(run.id, testCase.id);
      expect(runTopic?.status).toBe('error');
      expect(runTopic?.passed).toBe(false);
      expect(runTopic?.score).toBe(0);
      expect(runTopic?.evalResult).toMatchObject({
        completionReason: 'error',
        error: 'Connection refused',
        rubricScores: [],
      });
    });

    it('should handle non-Error thrown value', async () => {
      const { run, testCase } = await setupTrajectoryChain();

      mockExecAgent.mockRejectedValue('some string error');

      const service = new AgentEvalRunService(serverDB, userId);
      const result = await service.executeTrajectory({
        run: { datasetId: run.datasetId, targetAgentId: null },
        runId: run.id,
        testCase: { content: { input: 'test' }, sortOrder: 1 },
        testCaseId: testCase.id,
      });

      expect(result).toHaveProperty('error', 'Agent execution failed to start');
    });

    it('should use correct topic title with sortOrder and input', async () => {
      const { run, testCase } = await setupTrajectoryChain({
        input: 'A very long input that should be truncated at some point',
        sortOrder: 4,
      });

      mockExecAgent.mockResolvedValue({});

      const service = new AgentEvalRunService(serverDB, userId);
      const result = await service.executeTrajectory({
        run: { datasetId: run.datasetId, targetAgentId: null },
        runId: run.id,
        testCase: {
          content: { input: 'A very long input that should be truncated at some point' },
          sortOrder: 4,
        },
        testCaseId: testCase.id,
      });

      const allTopics = await serverDB.select().from(topics);
      const evalTopic = allTopics.find((t) => t.id === result.topicId);
      expect(evalTopic?.title).toContain('[Eval Case #5]');
      expect(evalTopic?.title).toContain('A very long input that should be truncated at so');
    });

    it('should use empty prompt when testCase.content.input is undefined', async () => {
      const { run, testCase } = await setupTrajectoryChain();

      mockExecAgent.mockResolvedValue({});

      const service = new AgentEvalRunService(serverDB, userId);
      await service.executeTrajectory({
        run: { datasetId: run.datasetId, targetAgentId: null },
        runId: run.id,
        testCase: { content: {}, sortOrder: null },
        testCaseId: testCase.id,
      });

      expect(mockExecAgent).toHaveBeenCalledWith(expect.objectContaining({ prompt: '' }));
    });
  });
});
