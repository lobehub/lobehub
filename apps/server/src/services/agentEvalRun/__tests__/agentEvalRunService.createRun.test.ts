import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentEvalBenchmarkModel, AgentEvalRunTopicModel } from '@/database/models/agentEval';
import { agentEvalDatasets, agentEvalTestCases, topics } from '@/database/schemas';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';

import { cleanupDB, serverDB, userId } from './_setup';

vi.mock('@/server/services/agentRuntime/AgentRuntimeService', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({
    interruptOperation: vi.fn().mockResolvedValue(true),
  })),
}));

beforeEach(cleanupDB);

describe('AgentEvalRunService', () => {
  describe('createRun', () => {
    it('should pre-create Topics and RunTopics with pending status', async () => {
      const benchmarkModel = new AgentEvalBenchmarkModel(serverDB, userId);
      const benchmark = await benchmarkModel.create({
        identifier: 'test-benchmark',
        isSystem: false,
        name: 'Test Benchmark',
        rubrics: [],
      });

      const [dataset] = await serverDB
        .insert(agentEvalDatasets)
        .values({
          benchmarkId: benchmark.id,
          identifier: 'test-dataset',
          name: 'Test Dataset',
          userId,
        })
        .returning();

      // Create 3 test cases
      const testCases = [];
      for (let i = 0; i < 3; i++) {
        const [tc] = await serverDB
          .insert(agentEvalTestCases)
          .values({
            userId,
            content: { expected: '42', input: `Question ${i + 1}` },
            datasetId: dataset.id,
            sortOrder: i + 1,
          })
          .returning();
        testCases.push(tc);
      }

      const service = new AgentEvalRunService(serverDB, userId);
      const run = await service.createRun({ datasetId: dataset.id, name: 'Pre-create Test' });

      // Verify RunTopics were created with pending status
      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
      const runTopics = await runTopicModel.findByRunId(run.id);

      expect(runTopics).toHaveLength(3);
      for (const rt of runTopics) {
        expect(rt.status).toBe('pending');
        expect(rt.topicId).toBeTruthy();
      }

      // Verify each test case has a corresponding RunTopic
      const testCaseIds = runTopics.map((rt) => rt.testCaseId).sort();
      const expectedIds = testCases.map((tc) => tc.id).sort();
      expect(testCaseIds).toEqual(expectedIds);

      // Verify topics were created with trigger='eval'
      for (const rt of runTopics) {
        const [topic] = await serverDB.select().from(topics).where(eq(topics.id, rt.topicId));
        expect(topic).toBeDefined();
        expect(topic.trigger).toBe('eval');
      }
    });

    it('should handle dataset with no test cases', async () => {
      const benchmarkModel = new AgentEvalBenchmarkModel(serverDB, userId);
      const benchmark = await benchmarkModel.create({
        identifier: 'empty-benchmark',
        isSystem: false,
        name: 'Empty Benchmark',
        rubrics: [],
      });

      const [dataset] = await serverDB
        .insert(agentEvalDatasets)
        .values({
          benchmarkId: benchmark.id,
          identifier: 'empty-dataset',
          name: 'Empty Dataset',
          userId,
        })
        .returning();

      const service = new AgentEvalRunService(serverDB, userId);
      const run = await service.createRun({ datasetId: dataset.id, name: 'Empty Test' });

      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
      const runTopics = await runTopicModel.findByRunId(run.id);

      expect(runTopics).toHaveLength(0);
      expect(run.id).toBeTruthy();
    });
  });
});
