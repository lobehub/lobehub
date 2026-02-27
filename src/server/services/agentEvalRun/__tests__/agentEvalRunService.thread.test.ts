import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AgentEvalBenchmarkModel,
  AgentEvalRunModel,
  AgentEvalRunTopicModel,
} from '@/database/models/agentEval';
import { ThreadModel } from '@/database/models/thread';
import { agentEvalDatasets, agentEvalTestCases, messages, topics } from '@/database/schemas';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';

import { cleanupDB, serverDB, userId } from './_setup';

vi.mock('@/server/services/agentRuntime/AgentRuntimeService', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({
    interruptOperation: vi.fn().mockResolvedValue(true),
  })),
}));

beforeEach(cleanupDB);

/**
 * Helper: set up a multi-thread eval chain for K>1 tests.
 * Creates benchmark → dataset → testCase → run(k) → topic → runTopic + K threads + assistant messages.
 */
async function setupMultiThreadEvalChain(opts: {
  assistantOutputs: string[]; // one per thread
  expected?: string;
  k: number;
}) {
  const benchmarkModel = new AgentEvalBenchmarkModel(serverDB, userId);
  const benchmark = await benchmarkModel.create({
    identifier: 'mt-benchmark',
    isSystem: false,
    name: 'Multi-Thread Benchmark',
    rubrics: [],
  });

  const [dataset] = await serverDB
    .insert(agentEvalDatasets)
    .values({
      benchmarkId: benchmark.id,
      evalMode: 'contains' as any,
      identifier: 'mt-dataset',
      name: 'MT Dataset',
      userId,
    })
    .returning();

  const [testCase] = await serverDB
    .insert(agentEvalTestCases)
    .values({
      userId,
      content: { expected: opts.expected ?? '42', input: 'What is 6*7?' },
      datasetId: dataset.id,
      sortOrder: 1,
    })
    .returning();

  const runModel = new AgentEvalRunModel(serverDB, userId);
  const run = await runModel.create({
    config: { k: opts.k },
    datasetId: dataset.id,
    name: 'MT Run',
  });
  await runModel.update(run.id, {
    metrics: {
      averageScore: 0,
      failedCases: 0,
      passRate: 0,
      passedCases: 0,
      totalCases: 1,
    },
  });

  const [topic] = await serverDB
    .insert(topics)
    .values({ mode: 'test', title: 'MT Topic', trigger: 'eval', userId })
    .returning();

  const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
  await runTopicModel.batchCreate([
    { runId: run.id, status: 'running' as const, testCaseId: testCase.id, topicId: topic.id },
  ]);

  // Create K threads
  const threadModel = new ThreadModel(serverDB, userId);
  const threadIds: string[] = [];
  for (let i = 0; i < opts.k; i++) {
    const thread = await threadModel.create({ topicId: topic.id, type: 'eval' });
    if (thread) threadIds.push(thread.id);
  }

  // Create assistant messages for each thread
  for (let i = 0; i < threadIds.length; i++) {
    if (opts.assistantOutputs[i] !== undefined && opts.assistantOutputs[i] !== null) {
      await serverDB.insert(messages).values({
        content: opts.assistantOutputs[i],
        role: 'assistant',
        threadId: threadIds[i],
        topicId: topic.id,
        userId,
      });
    }
  }

  return { benchmark, dataset, run, testCase, threadIds, topic };
}

describe('AgentEvalRunService', () => {
  describe('recordThreadCompletion (K>1)', () => {
    it('should return allThreadsDone=false when not all threads complete', async () => {
      const { run, testCase, threadIds, topic } = await setupMultiThreadEvalChain({
        assistantOutputs: ['42', '42'],
        k: 2,
      });

      const service = new AgentEvalRunService(serverDB, userId);

      // Complete only thread 1
      const result = await service.recordThreadCompletion({
        runId: run.id,
        status: 'completed',
        telemetry: { completionReason: 'stop', cost: 0.01, duration: 1000, totalTokens: 50 },
        testCaseId: testCase.id,
        threadId: threadIds[0],
        topicId: topic.id,
      });

      expect(result.allThreadsDone).toBe(false);
      expect(result.allRunDone).toBe(false);

      // RunTopic should still be running (not aggregated yet)
      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
      const rt = await runTopicModel.findByRunAndTestCase(run.id, testCase.id);
      expect(rt?.status).toBe('running');
    });

    it('should aggregate thread results when all K threads complete', async () => {
      const { run, testCase, threadIds, topic } = await setupMultiThreadEvalChain({
        assistantOutputs: ['42', '42'],
        expected: '42',
        k: 2,
      });

      const service = new AgentEvalRunService(serverDB, userId);

      // Complete thread 1
      await service.recordThreadCompletion({
        runId: run.id,
        status: 'completed',
        telemetry: {
          completionReason: 'stop',
          cost: 0.01,
          duration: 1000,
          llmCalls: 3,
          steps: 5,
          toolCalls: 2,
          totalTokens: 50,
        },
        testCaseId: testCase.id,
        threadId: threadIds[0],
        topicId: topic.id,
      });

      // Complete thread 2
      const result = await service.recordThreadCompletion({
        runId: run.id,
        status: 'completed',
        telemetry: {
          completionReason: 'stop',
          cost: 0.02,
          duration: 2000,
          llmCalls: 4,
          steps: 8,
          toolCalls: 6,
          totalTokens: 80,
        },
        testCaseId: testCase.id,
        threadId: threadIds[1],
        topicId: topic.id,
      });

      expect(result.allThreadsDone).toBe(true);
      expect(result.allRunDone).toBe(true);

      // Verify aggregated RunTopic
      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
      const rt = await runTopicModel.findByRunAndTestCase(run.id, testCase.id);

      // Both threads passed (contains '42')
      expect(rt?.status).toBe('passed');
      expect(rt?.passed).toBe(true);

      // passAtK and passAllK should be stored
      expect(rt?.evalResult?.passAtK).toBe(true);
      expect(rt?.evalResult?.passAllK).toBe(true);

      // threads array should contain per-thread results
      expect(rt?.evalResult?.threads).toHaveLength(2);

      // Primary fields should be AVERAGES (total / k)
      expect(rt?.evalResult?.cost).toBeCloseTo(0.015); // 0.03 / 2
      expect(rt?.evalResult?.duration).toBe(1500); // 3000 / 2
      expect(rt?.evalResult?.tokens).toBe(65); // 130 / 2
      expect(rt?.evalResult?.steps).toBe(6.5); // 13 / 2
      expect(rt?.evalResult?.llmCalls).toBe(3.5); // 7 / 2
      expect(rt?.evalResult?.toolCalls).toBe(4); // 8 / 2

      // total* fields should be cumulative across K threads
      expect(rt?.evalResult?.totalCost).toBeCloseTo(0.03); // 0.01 + 0.02
      expect(rt?.evalResult?.totalDuration).toBe(3000); // 1000 + 2000
      expect(rt?.evalResult?.totalTokens).toBe(130); // 50 + 80
    });

    it('should set passAtK=true and passAllK=false when one thread passes and one fails', async () => {
      const { run, testCase, threadIds, topic } = await setupMultiThreadEvalChain({
        assistantOutputs: ['42', 'wrong answer'],
        expected: '42',
        k: 2,
      });

      const service = new AgentEvalRunService(serverDB, userId);

      // Thread 1 passes (contains '42')
      await service.recordThreadCompletion({
        runId: run.id,
        status: 'completed',
        telemetry: { completionReason: 'stop', cost: 0.01, duration: 1000, totalTokens: 50 },
        testCaseId: testCase.id,
        threadId: threadIds[0],
        topicId: topic.id,
      });

      // Thread 2 fails (wrong answer)
      await service.recordThreadCompletion({
        runId: run.id,
        status: 'completed',
        telemetry: { completionReason: 'stop', cost: 0.02, duration: 2000, totalTokens: 80 },
        testCaseId: testCase.id,
        threadId: threadIds[1],
        topicId: topic.id,
      });

      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
      const rt = await runTopicModel.findByRunAndTestCase(run.id, testCase.id);

      // pass@k: at least one passed
      expect(rt?.evalResult?.passAtK).toBe(true);
      // pass^k: NOT all passed
      expect(rt?.evalResult?.passAllK).toBe(false);
      // Status should be passed (since pass@k = true, any thread passed)
      expect(rt?.status).toBe('passed');
      expect(rt?.passed).toBe(true);
    });

    it('should set passAtK=false and passAllK=false when all threads fail', async () => {
      const { run, testCase, threadIds, topic } = await setupMultiThreadEvalChain({
        assistantOutputs: ['wrong', 'also wrong'],
        expected: '42',
        k: 2,
      });

      const service = new AgentEvalRunService(serverDB, userId);

      await service.recordThreadCompletion({
        runId: run.id,
        status: 'completed',
        telemetry: { completionReason: 'stop', duration: 1000 },
        testCaseId: testCase.id,
        threadId: threadIds[0],
        topicId: topic.id,
      });

      await service.recordThreadCompletion({
        runId: run.id,
        status: 'completed',
        telemetry: { completionReason: 'stop', duration: 2000 },
        testCaseId: testCase.id,
        threadId: threadIds[1],
        topicId: topic.id,
      });

      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
      const rt = await runTopicModel.findByRunAndTestCase(run.id, testCase.id);

      expect(rt?.evalResult?.passAtK).toBe(false);
      expect(rt?.evalResult?.passAllK).toBe(false);
      expect(rt?.status).toBe('failed');
      expect(rt?.passed).toBe(false);
    });

    it('should handle error status in thread evaluation', async () => {
      const { run, testCase, threadIds, topic } = await setupMultiThreadEvalChain({
        assistantOutputs: ['42', ''],
        expected: '42',
        k: 2,
      });

      const service = new AgentEvalRunService(serverDB, userId);

      // Thread 1 passes
      await service.recordThreadCompletion({
        runId: run.id,
        status: 'completed',
        telemetry: {
          completionReason: 'stop',
          cost: 0.01,
          duration: 1000,
          llmCalls: 2,
          steps: 3,
          toolCalls: 1,
          totalTokens: 50,
        },
        testCaseId: testCase.id,
        threadId: threadIds[0],
        topicId: topic.id,
      });

      // Thread 2 has error
      await service.recordThreadCompletion({
        runId: run.id,
        status: 'error',
        telemetry: {
          completionReason: 'rate_limit',
          cost: 0.005,
          duration: 500,
          llmCalls: 1,
          steps: 1,
          toolCalls: 0,
          totalTokens: 10,
        },
        testCaseId: testCase.id,
        threadId: threadIds[1],
        topicId: topic.id,
      });

      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
      const rt = await runTopicModel.findByRunAndTestCase(run.id, testCase.id);

      // pass@k: thread 1 passed
      expect(rt?.evalResult?.passAtK).toBe(true);
      // pass^k: not all passed (thread 2 errored)
      expect(rt?.evalResult?.passAllK).toBe(false);

      // Primary fields should be AVERAGES (total / k)
      expect(rt?.evalResult?.cost).toBeCloseTo(0.0075); // 0.015 / 2
      expect(rt?.evalResult?.duration).toBe(750); // 1500 / 2
      expect(rt?.evalResult?.tokens).toBe(30); // 60 / 2
      expect(rt?.evalResult?.steps).toBe(2); // 4 / 2
      expect(rt?.evalResult?.llmCalls).toBe(1.5); // 3 / 2
      expect(rt?.evalResult?.toolCalls).toBe(0.5); // 1 / 2

      // total* fields should be cumulative across K threads
      expect(rt?.evalResult?.totalCost).toBeCloseTo(0.015);
      expect(rt?.evalResult?.totalDuration).toBe(1500);
      expect(rt?.evalResult?.totalTokens).toBe(60);
    });

    it('should persist llmCalls and toolCalls in thread metadata via evaluateThread', async () => {
      const { run, testCase, threadIds, topic } = await setupMultiThreadEvalChain({
        assistantOutputs: ['42'],
        expected: '42',
        k: 1,
      });

      const service = new AgentEvalRunService(serverDB, userId);

      await service.recordThreadCompletion({
        runId: run.id,
        status: 'completed',
        telemetry: {
          completionReason: 'stop',
          cost: 0.05,
          duration: 3000,
          llmCalls: 7,
          steps: 10,
          toolCalls: 12,
          totalTokens: 200,
        },
        testCaseId: testCase.id,
        threadId: threadIds[0],
        topicId: topic.id,
      });

      // Verify thread metadata has llmCalls and toolCalls
      const threadModel = new ThreadModel(serverDB, userId);
      const thread = await threadModel.findById(threadIds[0]);
      const meta = thread?.metadata as Record<string, unknown>;

      expect(meta?.llmCalls).toBe(7);
      expect(meta?.toolCalls).toBe(12);
      expect(meta?.steps).toBe(10);
      expect(meta?.cost).toBe(0.05);
      expect(meta?.duration).toBe(3000);
      expect(meta?.tokens).toBe(200);
    });

    it('should update run metrics after all threads complete', async () => {
      const { run, testCase, threadIds, topic } = await setupMultiThreadEvalChain({
        assistantOutputs: ['42', 'wrong'],
        expected: '42',
        k: 2,
      });

      const service = new AgentEvalRunService(serverDB, userId);

      await service.recordThreadCompletion({
        runId: run.id,
        status: 'completed',
        telemetry: {
          completionReason: 'stop',
          cost: 0.01,
          duration: 1000,
          llmCalls: 3,
          steps: 5,
          toolCalls: 2,
          totalTokens: 50,
        },
        testCaseId: testCase.id,
        threadId: threadIds[0],
        topicId: topic.id,
      });

      const result = await service.recordThreadCompletion({
        runId: run.id,
        status: 'completed',
        telemetry: {
          completionReason: 'stop',
          cost: 0.02,
          duration: 2000,
          llmCalls: 4,
          steps: 8,
          toolCalls: 6,
          totalTokens: 80,
        },
        testCaseId: testCase.id,
        threadId: threadIds[1],
        topicId: topic.id,
      });

      expect(result.allRunDone).toBe(true);

      // Verify run metrics updated
      const runModel = new AgentEvalRunModel(serverDB, userId);
      const updatedRun = await runModel.findById(run.id);

      expect(updatedRun?.metrics).toMatchObject({
        completedCases: 1,
        passedCases: 1, // pass@k: at least one thread passed
        failedCases: 0,
      });
      // Run metrics: cost/tokens = sum of per-case averages
      expect((updatedRun?.metrics as any).cost).toBeCloseTo(0.015); // avg cost per case: (0.01+0.02)/2
      expect((updatedRun?.metrics as any).tokens).toBe(65); // avg tokens per case: (50+80)/2
      // Run metrics: totalCost/totalTokens/totalDuration = actual cumulative across all K threads
      expect((updatedRun?.metrics as any).totalCost).toBeCloseTo(0.03); // 0.01 + 0.02
      expect((updatedRun?.metrics as any).totalDuration).toBe(3000); // 1000 + 2000
      expect((updatedRun?.metrics as any).totalTokens).toBe(130); // 50 + 80
      // Run metrics: steps/llmCalls/toolCalls = sum of per-case averages
      expect((updatedRun?.metrics as any).steps).toBe(6.5); // (5+8)/2
      expect((updatedRun?.metrics as any).llmCalls).toBe(3.5); // (3+4)/2
      expect((updatedRun?.metrics as any).toolCalls).toBe(4); // (2+6)/2
      // perCase = sum / completedCount (1 case completed)
      expect((updatedRun?.metrics as any).perCaseCost).toBeCloseTo(0.015);
      expect((updatedRun?.metrics as any).perCaseTokens).toBe(65);
      expect((updatedRun?.metrics as any).perCaseSteps).toBe(6.5);
      expect((updatedRun?.metrics as any).perCaseLlmCalls).toBe(3.5);
      expect((updatedRun?.metrics as any).perCaseToolCalls).toBe(4);
    });
  });
});
