import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import {
  AgentEvalBenchmarkModel,
  AgentEvalDatasetModel,
  AgentEvalRunModel,
  AgentEvalRunTopicModel,
  AgentEvalTestCaseModel,
} from '@/database/models/agentEval';
import { TopicModel } from '@/database/models/topic';
import {
  agentEvalBenchmarks,
  agentEvalDatasets,
  agentEvalRuns,
  agentEvalRunTopics,
  agentEvalTestCases,
  topics,
  users,
} from '@/database/schemas';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';

// Mock AgentRuntimeService to avoid ApiKeyManager env var access at module level
vi.mock('@/server/services/agentRuntime/AgentRuntimeService', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({
    interruptOperation: vi.fn().mockResolvedValue(true),
  })),
}));

const serverDB = await getTestDB();

const userId = 'run-integration-test-user';

beforeEach(async () => {
  // Clean up (order matters for FK constraints)
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

describe('AgentEval Run Workflow Integration', () => {
  describe('Run Execution Flow', () => {
    it('should create run with test data', async () => {
      // 1. Create benchmark
      const benchmarkModel = new AgentEvalBenchmarkModel(serverDB, userId);
      const benchmark = await benchmarkModel.create({
        identifier: 'test-benchmark',
        name: 'Test Benchmark',
        rubrics: [],

        isSystem: false,
      });

      // 2. Create dataset
      const datasetModel = new AgentEvalDatasetModel(serverDB, userId);
      const dataset = await datasetModel.create({
        benchmarkId: benchmark.id,
        identifier: 'test-dataset',
        name: 'Test Dataset',
      });

      // 3. Create test cases
      const testCaseModel = new AgentEvalTestCaseModel(serverDB, userId);
      const testCase1 = await testCaseModel.create({
        datasetId: dataset.id,
        content: { input: 'What is the capital of France?' },
        sortOrder: 1,
      });
      const testCase2 = await testCaseModel.create({
        datasetId: dataset.id,
        content: { input: 'What is 2 + 2?' },
        sortOrder: 2,
      });

      // 4. Create run
      const runModel = new AgentEvalRunModel(serverDB, userId);
      const run = await runModel.create({
        datasetId: dataset.id,
        name: 'Test Run',
        config: {
          concurrency: 5,
          timeout: 300000,
        },
      });

      expect(run).toBeDefined();
      expect(run.status).toBe('idle');
      expect(run.datasetId).toBe(dataset.id);

      console.log('\n📊 Test Data Created:');
      console.log(`  Benchmark: ${benchmark.id}`);
      console.log(`  Dataset: ${dataset.id}`);
      console.log(`  Test Cases: ${testCase1.id}, ${testCase2.id}`);
      console.log(`  Run: ${run.id}`);
      console.log('\n🧪 To test workflow execution, call:');
      console.log(`  startRun({ id: "${run.id}" })`);
    });

    it('should validate run status before execution', async () => {
      // Create test data
      const benchmarkModel = new AgentEvalBenchmarkModel(serverDB, userId);
      const benchmark = await benchmarkModel.create({
        identifier: 'test-benchmark-2',
        name: 'Test Benchmark 2',
        rubrics: [],

        isSystem: false,
      });

      const datasetModel = new AgentEvalDatasetModel(serverDB, userId);
      const dataset = await datasetModel.create({
        benchmarkId: benchmark.id,
        identifier: 'test-dataset-2',
        name: 'Test Dataset 2',
      });

      const testCaseModel = new AgentEvalTestCaseModel(serverDB, userId);
      await testCaseModel.create({
        datasetId: dataset.id,
        content: { input: 'Test question' },
        sortOrder: 1,
      });

      const runModel = new AgentEvalRunModel(serverDB, userId);
      const run = await runModel.create({
        datasetId: dataset.id,
        name: 'Test Run 2',
      });

      // Verify run is in idle state
      expect(run.status).toBe('idle');

      // Update to running (simulating workflow start)
      const updatedRun = await runModel.update(run.id, { status: 'running' });
      expect(updatedRun?.status).toBe('running');

      console.log('\n✅ Run status validation passed');
    });
  });

  describe('deleteRun', () => {
    it('should delete associated topics when deleting a run', async () => {
      // 1. Setup: benchmark → dataset → testCase → run
      const benchmarkModel = new AgentEvalBenchmarkModel(serverDB, userId);
      const benchmark = await benchmarkModel.create({
        identifier: 'delete-test-benchmark',
        isSystem: false,
        name: 'Delete Test Benchmark',
        rubrics: [],
      });

      const datasetModel = new AgentEvalDatasetModel(serverDB, userId);
      const dataset = await datasetModel.create({
        benchmarkId: benchmark.id,
        identifier: 'delete-test-dataset',
        name: 'Delete Test Dataset',
      });

      const testCaseModel = new AgentEvalTestCaseModel(serverDB, userId);
      const testCase = await testCaseModel.create({
        content: { input: 'Test question' },
        datasetId: dataset.id,
        sortOrder: 1,
      });

      const runModel = new AgentEvalRunModel(serverDB, userId);
      const run = await runModel.create({
        datasetId: dataset.id,
        name: 'Delete Test Run',
      });

      // 2. Create topics (simulating what the eval workflow does)
      const topicModel = new TopicModel(serverDB, userId);
      const topic1 = await topicModel.create({ title: 'Eval Topic 1', trigger: 'eval' });
      const topic2 = await topicModel.create({ title: 'Eval Topic 2', trigger: 'eval' });

      // 3. Create RunTopic associations
      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
      await runTopicModel.batchCreate([
        { runId: run.id, testCaseId: testCase.id, topicId: topic1.id },
        { runId: run.id, testCaseId: testCase.id, topicId: topic2.id },
      ]);

      // Verify setup: topics exist
      expect(await topicModel.findById(topic1.id)).toBeDefined();
      expect(await topicModel.findById(topic2.id)).toBeDefined();

      // 4. Delete run via service
      const service = new AgentEvalRunService(serverDB, userId);
      await service.deleteRun(run.id);

      // 5. Verify: run is deleted
      const deletedRun = await runModel.findById(run.id);
      expect(deletedRun).toBeUndefined();

      // 6. Verify: topics are also deleted (this was the bug)
      expect(await topicModel.findById(topic1.id)).toBeUndefined();
      expect(await topicModel.findById(topic2.id)).toBeUndefined();
    });
  });

  describe('Run Results Query', () => {
    it('should query run with dataset info', async () => {
      // Setup test data
      const benchmarkModel = new AgentEvalBenchmarkModel(serverDB, userId);
      const benchmark = await benchmarkModel.create({
        identifier: 'query-test-benchmark',
        name: 'Query Test Benchmark',
        rubrics: [],

        isSystem: false,
      });

      const datasetModel = new AgentEvalDatasetModel(serverDB, userId);
      const dataset = await datasetModel.create({
        benchmarkId: benchmark.id,
        identifier: 'query-test-dataset',
        name: 'Query Test Dataset',
      });

      const runModel = new AgentEvalRunModel(serverDB, userId);
      const run = await runModel.create({
        datasetId: dataset.id,
        name: 'Query Test Run',
        metrics: {
          totalCases: 10,
          passedCases: 7,
          failedCases: 3,
          averageScore: 0.7,
          passRate: 0.7,
        },
      });

      // Query run
      const foundRun = await runModel.findById(run.id);
      expect(foundRun).toBeDefined();
      expect(foundRun?.datasetId).toBe(dataset.id);
      expect(foundRun?.metrics?.passRate).toBe(0.7);

      console.log('\n📈 Run Metrics:');
      console.log(`  Total Cases: ${foundRun?.metrics?.totalCases}`);
      console.log(`  Passed: ${foundRun?.metrics?.passedCases}`);
      console.log(`  Failed: ${foundRun?.metrics?.failedCases}`);
      console.log(`  Pass Rate: ${(foundRun?.metrics?.passRate || 0) * 100}%`);
    });
  });
});
