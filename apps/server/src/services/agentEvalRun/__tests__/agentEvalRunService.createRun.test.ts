import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentEvalBenchmarkModel, AgentEvalRunTopicModel } from '@/database/models/agentEval';
import {
  agentEvalDatasets,
  agentEvalTestCases,
  messagePlugins,
  messages,
  threads,
  topics,
} from '@/database/schemas';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';

import { cleanupDB, serverDB, userId } from './_setup';

vi.mock('@/server/services/agentRuntime/AgentRuntimeService', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({
    interruptOperation: vi.fn().mockResolvedValue(true),
  })),
}));

vi.mock('@/server/workflows/agentEvalRun', () => ({
  AgentEvalRunWorkflow: {
    triggerRunThreadTrajectory: vi.fn(),
  },
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

    it('should store caseSelection without changing internal topic pre-creation', async () => {
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

      for (let i = 0; i < 2; i++) {
        await serverDB.insert(agentEvalTestCases).values({
          userId,
          content: { input: `Question ${i + 1}` },
          datasetId: dataset.id,
          metadata: { caseId: `case_${i + 1}` },
          sortOrder: i + 1,
        });
      }

      const service = new AgentEvalRunService(serverDB, userId);
      const caseSelection = { caseIds: ['case_1'], mode: 'include' as const };
      const run = await service.createRun({ config: { caseSelection }, datasetId: dataset.id });

      // Stored verbatim
      expect((run.config as any).caseSelection).toEqual(caseSelection);

      // Storage-only scope: internal pre-creation is unaffected (all cases)
      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
      expect(await runTopicModel.findByRunId(run.id)).toHaveLength(2);
    });

    it('should restore case messages and use their tail as the eval-thread source', async () => {
      const benchmarkModel = new AgentEvalBenchmarkModel(serverDB, userId);
      const benchmark = await benchmarkModel.create({
        identifier: 'history-benchmark',
        isSystem: false,
        name: 'History Benchmark',
        rubrics: [],
      });
      const [dataset] = await serverDB
        .insert(agentEvalDatasets)
        .values({
          benchmarkId: benchmark.id,
          identifier: 'history-dataset',
          name: 'History Dataset',
          userId,
        })
        .returning();
      const [testCase] = await serverDB
        .insert(agentEvalTestCases)
        .values({
          content: {
            input: 'Continue from the prior answer',
            messages: [
              { content: 'Prior question', id: 'history-user', role: 'user' },
              {
                content: 'Prior answer',
                id: 'history-assistant',
                parentId: 'history-user',
                role: 'assistant',
              },
            ],
          },
          datasetId: dataset.id,
          sortOrder: 1,
          userId,
        })
        .returning();

      const service = new AgentEvalRunService(serverDB, userId);
      const run = await service.createRun({ config: { k: 2 }, datasetId: dataset.id });
      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
      const runTopic = await runTopicModel.findByRunAndTestCase(run.id, testCase.id);
      const restored = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.topicId, runTopic!.topicId))
        .orderBy(messages.createdAt);

      expect(restored.map((message) => message.content)).toEqual([
        'Prior question',
        'Prior answer',
      ]);
      expect(restored.map((message) => message.agentId)).toEqual([null, null]);

      const [topic] = await serverDB.select().from(topics).where(eq(topics.id, runTopic!.topicId));
      expect(topic.metadata?.evalHistoryTailMessageId).toBe(restored[1].id);

      await service.executeMultiThreadTrajectory({
        k: 2,
        run: { config: run.config, datasetId: run.datasetId, targetAgentId: run.targetAgentId },
        runId: run.id,
        testCaseId: testCase.id,
      });

      const attempts = await serverDB
        .select()
        .from(threads)
        .where(eq(threads.topicId, runTopic!.topicId));

      expect(attempts).toHaveLength(2);
      expect(attempts.map((thread) => thread.sourceMessageId)).toEqual([
        restored[1].id,
        restored[1].id,
      ]);
    });

    it('should restore large histories in input order and preserve interventions', async () => {
      const benchmarkModel = new AgentEvalBenchmarkModel(serverDB, userId);
      const benchmark = await benchmarkModel.create({
        identifier: 'large-history-benchmark',
        isSystem: false,
        name: 'Large History Benchmark',
        rubrics: [],
      });
      const [dataset] = await serverDB
        .insert(agentEvalDatasets)
        .values({
          benchmarkId: benchmark.id,
          identifier: 'large-history-dataset',
          name: 'Large History Dataset',
          userId,
        })
        .returning();
      const history: Array<{
        content: string;
        createdAt: number;
        pluginIntervention?: { status: 'pending' };
        role: 'assistant' | 'tool' | 'user';
      }> = Array.from({ length: 500 }, (_, index) => ({
        content: `History message ${index}`,
        createdAt: index % 3,
        role: index % 2 === 0 ? 'user' : 'assistant',
      }));
      history.push({
        content: 'Awaiting approval',
        createdAt: 0,
        pluginIntervention: { status: 'pending' },
        role: 'tool',
      });

      const [testCase] = await serverDB
        .insert(agentEvalTestCases)
        .values({
          content: { input: 'Continue the conversation', messages: history },
          datasetId: dataset.id,
          sortOrder: 1,
          userId,
        })
        .returning();

      const service = new AgentEvalRunService(serverDB, userId);
      const run = await service.createRun({ datasetId: dataset.id });
      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
      const runTopic = await runTopicModel.findByRunAndTestCase(run.id, testCase.id);
      const restored = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.topicId, runTopic!.topicId))
        .orderBy(messages.createdAt);

      expect(restored.map((message) => message.content)).toEqual(
        history.map((message) => message.content),
      );
      expect(restored[0].parentId).toBeNull();
      expect(
        restored.slice(1).every((message, index) => message.parentId === restored[index].id),
      ).toBe(true);
      expect(
        restored.every(
          (message, index) => index === 0 || message.createdAt > restored[index - 1].createdAt,
        ),
      ).toBe(true);

      const [plugin] = await serverDB
        .select()
        .from(messagePlugins)
        .where(eq(messagePlugins.id, restored.at(-1)!.id));
      expect(plugin.intervention).toEqual({ status: 'pending' });

      const [topic] = await serverDB.select().from(topics).where(eq(topics.id, runTopic!.topicId));
      expect(topic.metadata?.evalHistoryTailMessageId).toBe(restored.at(-1)?.id);
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
