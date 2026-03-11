// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import {
  AgentEvalBenchmarkModel,
  AgentEvalDatasetModel,
  AgentEvalRunModel,
  AgentEvalRunTopicModel,
  AgentEvalTestCaseModel,
} from '@/database/models/agentEval';
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

const serverDB = await getTestDB();

const userId = 'eval-case-integration-test-user';

beforeEach(async () => {
  // Clean up (order matters for FK constraints)
  await serverDB.delete(messages);
  await serverDB.delete(agentEvalRunTopics);
  await serverDB.delete(agentEvalRuns);
  await serverDB.delete(agentEvalTestCases);
  await serverDB.delete(agentEvalDatasets);
  await serverDB.delete(agentEvalBenchmarks);
  await serverDB.delete(topics);
  await serverDB.delete(users);

  // Create test user
  await serverDB.insert(users).values({ id: userId });
});

/**
 * Helper: set up a full eval chain (benchmark → dataset → testCase → run → topic → runTopic → message)
 */
async function setupEvalChain(opts: {
  benchmarkRubrics?: any[];
  datasetEvalConfig?: any;
  datasetEvalMode?: string | null;
  expected?: string;
  output: string;
  testCaseEvalConfig?: any;
  testCaseEvalMode?: string | null;
}) {
  const benchmarkModel = new AgentEvalBenchmarkModel(serverDB, userId);
  const benchmark = await benchmarkModel.create({
    identifier: 'test-benchmark',
    isSystem: false,
    name: 'Test Benchmark',
    rubrics: opts.benchmarkRubrics ?? [],
  });

  const datasetModel = new AgentEvalDatasetModel(serverDB, userId);
  const [dataset] = await serverDB
    .insert(agentEvalDatasets)
    .values({
      benchmarkId: benchmark.id,
      evalConfig: opts.datasetEvalConfig,
      evalMode: opts.datasetEvalMode as any,
      identifier: 'test-dataset',
      name: 'Test Dataset',
      userId,
    })
    .returning();

  const testCaseModel = new AgentEvalTestCaseModel(serverDB, userId);
  const [testCase] = await serverDB
    .insert(agentEvalTestCases)
    .values({
      userId,
      content: { expected: opts.expected ?? '42', input: 'What is 6*7?' },
      datasetId: dataset.id,
      evalConfig: opts.testCaseEvalConfig,
      evalMode: opts.testCaseEvalMode as any,
      sortOrder: 1,
    })
    .returning();

  const runModel = new AgentEvalRunModel(serverDB, userId);
  const run = await runModel.create({
    datasetId: dataset.id,
    name: 'Test Run',
  });

  // Create topic
  const [topic] = await serverDB
    .insert(topics)
    .values({ mode: 'test', title: 'Eval Topic', trigger: 'eval', userId })
    .returning();

  // Create runTopic
  const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
  await runTopicModel.batchCreate([{ runId: run.id, testCaseId: testCase.id, topicId: topic.id }]);

  // Create assistant message in this topic
  await serverDB.insert(messages).values({
    content: opts.output,
    role: 'assistant',
    topicId: topic.id,
    userId,
  });

  return { benchmark, dataset, run, testCase, topic };
}

describe('evaluateCase - evalMode resolution', () => {
  it('should use dataset evalMode when testCase has no evalMode', async () => {
    const { run, testCase, topic } = await setupEvalChain({
      datasetEvalMode: 'contains',
      expected: '42',
      output: 'The answer is 42.',
      testCaseEvalMode: null,
    });

    const service = new AgentEvalRunService(serverDB, userId);
    await service.recordTrajectoryCompletion({
      runId: run.id,
      testCaseId: testCase.id,
      telemetry: { completionReason: 'stop', duration: 100 },
    });

    // Check the runTopic was evaluated and passed
    const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
    const runTopic = await runTopicModel.findByRunAndTestCase(run.id, testCase.id);

    expect(runTopic?.status).toBe('passed');
    expect(runTopic?.score).toBe(1);
  });

  it('should use testCase evalMode over dataset evalMode', async () => {
    const { run, testCase } = await setupEvalChain({
      datasetEvalMode: 'equals', // would fail: "The answer is 42" !== "42"
      expected: '42',
      output: 'The answer is 42.',
      testCaseEvalMode: 'contains', // should pass: output contains "42"
    });

    const service = new AgentEvalRunService(serverDB, userId);
    await service.recordTrajectoryCompletion({
      runId: run.id,
      testCaseId: testCase.id,
      telemetry: { completionReason: 'stop', duration: 100 },
    });

    const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
    const runTopic = await runTopicModel.findByRunAndTestCase(run.id, testCase.id);

    expect(runTopic?.status).toBe('passed');
    expect(runTopic?.score).toBe(1);
  });

  it('should fall back to benchmark rubrics when no evalMode is set', async () => {
    const { run, testCase } = await setupEvalChain({
      benchmarkRubrics: [{ config: {}, id: 'r1', name: 'Contains', type: 'contains', weight: 1 }],
      datasetEvalMode: null,
      expected: '42',
      output: 'The answer is 42.',
      testCaseEvalMode: null,
    });

    const service = new AgentEvalRunService(serverDB, userId);
    await service.recordTrajectoryCompletion({
      runId: run.id,
      testCaseId: testCase.id,
      telemetry: { completionReason: 'stop', duration: 100 },
    });

    const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
    const runTopic = await runTopicModel.findByRunAndTestCase(run.id, testCase.id);

    expect(runTopic?.status).toBe('passed');
    expect(runTopic?.score).toBe(1);
  });

  it('should skip evaluation when no evalMode and no benchmark rubrics', async () => {
    const { run, testCase } = await setupEvalChain({
      benchmarkRubrics: [],
      datasetEvalMode: null,
      expected: '42',
      output: '42',
      testCaseEvalMode: null,
    });

    const service = new AgentEvalRunService(serverDB, userId);
    await service.recordTrajectoryCompletion({
      runId: run.id,
      testCaseId: testCase.id,
      telemetry: { completionReason: 'stop', duration: 100 },
    });

    const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
    const runTopic = await runTopicModel.findByRunAndTestCase(run.id, testCase.id);

    // Should NOT have been evaluated — no status change beyond telemetry write
    expect(runTopic?.status).toBeNull();
    expect(runTopic?.score).toBeNull();
  });

  it('should not crash when benchmark rubrics is empty and evalMode is null everywhere', async () => {
    // rubrics column is NOT NULL in DB, so worst case is empty array []
    // Combined with evalMode=null everywhere, this exercises the "no eval rules" path
    const { run, testCase } = await setupEvalChain({
      benchmarkRubrics: [],
      datasetEvalMode: null,
      expected: '42',
      output: '42',
      testCaseEvalMode: null,
    });

    const service = new AgentEvalRunService(serverDB, userId);

    // This should NOT throw — should gracefully skip evaluation
    await expect(
      service.recordTrajectoryCompletion({
        runId: run.id,
        testCaseId: testCase.id,
        telemetry: { completionReason: 'stop', duration: 100 },
      }),
    ).resolves.not.toThrow();

    // Verify: no evaluation happened (score/status remain null)
    const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
    const runTopic = await runTopicModel.findByRunAndTestCase(run.id, testCase.id);
    expect(runTopic?.score).toBeNull();
    expect(runTopic?.status).toBeNull();
  });
});
