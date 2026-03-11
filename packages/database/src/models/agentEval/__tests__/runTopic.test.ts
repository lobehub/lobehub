import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  agentEvalBenchmarks,
  agentEvalDatasets,
  agentEvalRuns,
  agentEvalRunTopics,
  agentEvalTestCases,
  topics,
  users,
} from '../../../schemas';
import { AgentEvalRunTopicModel } from '../runTopic';

const serverDB = await getTestDB();

const userId = 'run-topic-test-user';
const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);

let benchmarkId: string;
let datasetId: string;
let runId: string;
let testCaseId1: string;
let testCaseId2: string;
let topicId1: string;
let topicId2: string;

beforeEach(async () => {
  await serverDB.delete(agentEvalRunTopics);
  await serverDB.delete(topics);
  await serverDB.delete(agentEvalRuns);
  await serverDB.delete(agentEvalTestCases);
  await serverDB.delete(agentEvalDatasets);
  await serverDB.delete(agentEvalBenchmarks);
  await serverDB.delete(users);

  // Create test user
  await serverDB.insert(users).values({ id: userId });

  // Create test benchmark
  const [benchmark] = await serverDB
    .insert(agentEvalBenchmarks)
    .values({
      identifier: 'test-benchmark',
      name: 'Test Benchmark',
      rubrics: [],
      isSystem: false,
    })
    .returning();
  benchmarkId = benchmark.id;

  // Create test dataset
  const [dataset] = await serverDB
    .insert(agentEvalDatasets)
    .values({
      benchmarkId,
      identifier: 'test-dataset',
      name: 'Test Dataset',
      userId,
    })
    .returning();
  datasetId = dataset.id;

  // Create test cases
  const [testCase1, testCase2] = await serverDB
    .insert(agentEvalTestCases)
    .values([
      {
        userId,
        datasetId,
        content: { input: 'Test question 1' },
        sortOrder: 1,
      },
      {
        userId,
        datasetId,
        content: { input: 'Test question 2' },
        sortOrder: 2,
      },
    ])
    .returning();
  testCaseId1 = testCase1.id;
  testCaseId2 = testCase2.id;

  // Create test run
  const [run] = await serverDB
    .insert(agentEvalRuns)
    .values({
      datasetId,
      userId,
      name: 'Test Run',
      status: 'idle',
    })
    .returning();
  runId = run.id;

  // Create topics
  const [topic1, topic2] = await serverDB
    .insert(topics)
    .values([
      {
        userId,
        title: 'Topic 1',
        trigger: 'eval',
        mode: 'test',
      },
      {
        userId,
        title: 'Topic 2',
        trigger: 'eval',
        mode: 'test',
      },
    ])
    .returning();
  topicId1 = topic1.id;
  topicId2 = topic2.id;
});

afterEach(async () => {
  await serverDB.delete(agentEvalRunTopics);
  await serverDB.delete(topics);
  await serverDB.delete(agentEvalRuns);
  await serverDB.delete(agentEvalTestCases);
  await serverDB.delete(agentEvalDatasets);
  await serverDB.delete(agentEvalBenchmarks);
  await serverDB.delete(users);
});

describe('AgentEvalRunTopicModel', () => {
  describe('batchCreate', () => {
    it('should create multiple run topics', async () => {
      const params = [
        {
          runId,
          topicId: topicId1,
          testCaseId: testCaseId1,
        },
        {
          runId,
          topicId: topicId2,
          testCaseId: testCaseId2,
        },
      ];

      const results = await runTopicModel.batchCreate(params);

      expect(results).toHaveLength(2);
      expect(results[0].runId).toBe(runId);
      expect(results[0].topicId).toBe(topicId1);
      expect(results[0].testCaseId).toBe(testCaseId1);
      expect(results[0].createdAt).toBeDefined();

      expect(results[1].runId).toBe(runId);
      expect(results[1].topicId).toBe(topicId2);
      expect(results[1].testCaseId).toBe(testCaseId2);
    });

    it('should handle empty array', async () => {
      const results = await runTopicModel.batchCreate([]);

      expect(results).toHaveLength(0);
    });
  });

  describe('findByRunId', () => {
    beforeEach(async () => {
      await serverDB.insert(agentEvalRunTopics).values([
        {
          userId,
          runId,
          topicId: topicId1,
          testCaseId: testCaseId1,
        },
        {
          userId,
          runId,
          topicId: topicId2,
          testCaseId: testCaseId2,
        },
      ]);
    });

    it('should find run topics with relations', async () => {
      const results = await runTopicModel.findByRunId(runId);

      expect(results).toHaveLength(2);
      expect(results[0].runId).toBe(runId);
      expect(results[0].status).toBeNull();
      expect(results[0].topic).toBeDefined();
      expect((results[0].topic as any).id).toBe(topicId1);
      expect((results[0].topic as any).title).toBe('Topic 1');
      expect(results[0].testCase).toBeDefined();
      expect((results[0].testCase as any).id).toBe(testCaseId1);
    });

    it('should return status field after update', async () => {
      await runTopicModel.updateByRunAndTopic(runId, topicId1, { status: 'passed' });
      await runTopicModel.updateByRunAndTopic(runId, topicId2, { status: 'error' });

      const results = await runTopicModel.findByRunId(runId);

      expect(results[0].status).toBe('passed');
      expect(results[1].status).toBe('error');
    });

    it('should order by createdAt ascending', async () => {
      const results = await runTopicModel.findByRunId(runId);

      expect(results.length).toBe(2);
      // First created should be first
      expect(results[0].topicId).toBe(topicId1);
      expect(results[1].topicId).toBe(topicId2);
    });

    it('should return empty array when no topics exist', async () => {
      const [emptyRun] = await serverDB
        .insert(agentEvalRuns)
        .values({
          datasetId,
          userId,
          status: 'idle',
        })
        .returning();

      const results = await runTopicModel.findByRunId(emptyRun.id);

      expect(results).toHaveLength(0);
    });
  });

  describe('deleteByRunId', () => {
    beforeEach(async () => {
      await serverDB.insert(agentEvalRunTopics).values([
        {
          userId,
          runId,
          topicId: topicId1,
          testCaseId: testCaseId1,
        },
        {
          userId,
          runId,
          topicId: topicId2,
          testCaseId: testCaseId2,
        },
      ]);
    });

    it('should delete all topics for a run', async () => {
      await runTopicModel.deleteByRunId(runId);

      const remaining = await serverDB.query.agentEvalRunTopics.findMany({
        where: eq(agentEvalRunTopics.runId, runId),
      });

      expect(remaining).toHaveLength(0);
    });

    it('should not affect other runs', async () => {
      // Create another run with topics
      const [otherRun] = await serverDB
        .insert(agentEvalRuns)
        .values({
          datasetId,
          userId,
          status: 'idle',
        })
        .returning();

      const [otherTopic] = await serverDB
        .insert(topics)
        .values({
          userId,
          title: 'Other Topic',
          trigger: 'eval',
        })
        .returning();

      await serverDB.insert(agentEvalRunTopics).values({
        userId,
        runId: otherRun.id,
        topicId: otherTopic.id,
        testCaseId: testCaseId1,
      });

      await runTopicModel.deleteByRunId(runId);

      const otherRunTopics = await serverDB.query.agentEvalRunTopics.findMany({
        where: eq(agentEvalRunTopics.runId, otherRun.id),
      });

      expect(otherRunTopics).toHaveLength(1);
    });
  });

  describe('findByTestCaseId', () => {
    beforeEach(async () => {
      await serverDB.insert(agentEvalRunTopics).values([
        {
          userId,
          runId,
          topicId: topicId1,
          testCaseId: testCaseId1,
        },
        {
          userId,
          runId,
          topicId: topicId2,
          testCaseId: testCaseId2,
        },
      ]);
    });

    it('should find topics by test case id', async () => {
      const results = await runTopicModel.findByTestCaseId(testCaseId1);

      expect(results).toHaveLength(1);
      expect(results[0].testCaseId).toBe(testCaseId1);
      expect(results[0].topicId).toBe(topicId1);
    });

    it('should return empty array when no topics exist for test case', async () => {
      const [newTestCase] = await serverDB
        .insert(agentEvalTestCases)
        .values({
          userId,
          datasetId,
          content: { input: 'Unused test case' },
          sortOrder: 3,
        })
        .returning();

      const results = await runTopicModel.findByTestCaseId(newTestCase.id);

      expect(results).toHaveLength(0);
    });
  });

  describe('findByRunAndTestCase', () => {
    beforeEach(async () => {
      await serverDB.insert(agentEvalRunTopics).values([
        {
          userId,
          runId,
          topicId: topicId1,
          testCaseId: testCaseId1,
        },
        {
          userId,
          runId,
          topicId: topicId2,
          testCaseId: testCaseId2,
        },
      ]);
    });

    it('should find specific run-testcase combination', async () => {
      const result = await runTopicModel.findByRunAndTestCase(runId, testCaseId1);

      expect(result).toBeDefined();
      expect(result?.runId).toBe(runId);
      expect(result?.testCaseId).toBe(testCaseId1);
      expect(result?.topicId).toBe(topicId1);
      expect(result?.status).toBeNull();
    });

    it('should return status field after update', async () => {
      await runTopicModel.updateByRunAndTopic(runId, topicId1, { status: 'failed' });

      const result = await runTopicModel.findByRunAndTestCase(runId, testCaseId1);

      expect(result?.status).toBe('failed');
    });

    it('should return undefined when combination not found', async () => {
      const [otherRun] = await serverDB
        .insert(agentEvalRuns)
        .values({
          datasetId,
          userId,
          status: 'idle',
        })
        .returning();

      const result = await runTopicModel.findByRunAndTestCase(otherRun.id, testCaseId1);

      expect(result).toBeUndefined();
    });
  });

  describe('updateByRunAndTopic', () => {
    beforeEach(async () => {
      await serverDB.insert(agentEvalRunTopics).values({
        userId,
        runId,
        topicId: topicId1,
        testCaseId: testCaseId1,
      });
    });

    it('should update score and passed fields', async () => {
      const result = await runTopicModel.updateByRunAndTopic(runId, topicId1, {
        score: 0.85,
        passed: true,
        evalResult: {
          rubricScores: [{ rubricId: 'r1', score: 0.85 }],
        },
      });

      expect(result.score).toBe(0.85);
      expect(result.passed).toBe(true);
      expect(result.evalResult).toEqual({
        rubricScores: [{ rubricId: 'r1', score: 0.85 }],
      });
    });

    it('should update only specified fields', async () => {
      await runTopicModel.updateByRunAndTopic(runId, topicId1, {
        score: 0,
        passed: false,
      });

      const updated = await serverDB.query.agentEvalRunTopics.findFirst({
        where: eq(agentEvalRunTopics.topicId, topicId1),
      });

      expect(updated?.score).toBe(0);
      expect(updated?.passed).toBe(false);
      expect(updated?.evalResult).toBeNull();
    });

    it('should update status field', async () => {
      const result = await runTopicModel.updateByRunAndTopic(runId, topicId1, {
        status: 'passed',
        score: 1,
        passed: true,
      });

      expect(result.status).toBe('passed');
      expect(result.score).toBe(1);
      expect(result.passed).toBe(true);
    });

    it('should update status to error with evalResult', async () => {
      const result = await runTopicModel.updateByRunAndTopic(runId, topicId1, {
        status: 'error',
        score: 0,
        passed: false,
        evalResult: {
          error: 'Execution error: insufficient_user_quota',
          rubricScores: [],
        },
      });

      expect(result.status).toBe('error');
      expect(result.passed).toBe(false);
      expect(result.evalResult).toMatchObject({
        error: 'Execution error: insufficient_user_quota',
      });
    });
  });

  describe('batchMarkTimeout', () => {
    it('should mark old running topics as timeout, leave recent ones alone', async () => {
      // Create 3 topics
      const [topic3] = await serverDB
        .insert(topics)
        .values({ userId, title: 'Topic 3', trigger: 'eval', mode: 'test' })
        .returning();

      await serverDB.insert(agentEvalRunTopics).values([
        { userId, runId, topicId: topicId1, testCaseId: testCaseId1, status: 'running' },
        { userId, runId, topicId: topicId2, testCaseId: testCaseId2, status: 'running' },
        { userId, runId, topicId: topic3.id, testCaseId: testCaseId1, status: 'running' },
      ]);

      // Backdate topic1 to 30 min ago, topic2 to 25 min ago, leave topic3 recent
      await serverDB
        .update(agentEvalRunTopics)
        .set({ createdAt: sql`NOW() - interval '30 minutes'` })
        .where(eq(agentEvalRunTopics.topicId, topicId1));
      await serverDB
        .update(agentEvalRunTopics)
        .set({ createdAt: sql`NOW() - interval '25 minutes'` })
        .where(eq(agentEvalRunTopics.topicId, topicId2));

      // Timeout = 20 min (1_200_000 ms)
      const rows = await runTopicModel.batchMarkTimeout(runId, 1_200_000);

      expect(rows).toHaveLength(2); // topic1 (30min) and topic2 (25min) > 20min

      const all = await serverDB.query.agentEvalRunTopics.findMany({
        where: eq(agentEvalRunTopics.runId, runId),
      });

      const statusMap = Object.fromEntries(all.map((r) => [r.topicId, r.status]));
      expect(statusMap[topicId1]).toBe('timeout');
      expect(statusMap[topicId2]).toBe('timeout');
      expect(statusMap[topic3.id]).toBe('running'); // recent, not timed out
    });

    it('should not touch topics already in terminal state', async () => {
      await serverDB.insert(agentEvalRunTopics).values([
        { userId, runId, topicId: topicId1, testCaseId: testCaseId1, status: 'passed' },
        { userId, runId, topicId: topicId2, testCaseId: testCaseId2, status: 'running' },
      ]);

      // Backdate both to 30 min ago
      await serverDB
        .update(agentEvalRunTopics)
        .set({ createdAt: sql`NOW() - interval '30 minutes'` })
        .where(eq(agentEvalRunTopics.runId, runId));

      const rows = await runTopicModel.batchMarkTimeout(runId, 1_200_000);

      expect(rows).toHaveLength(1); // only topic2 (running), not topic1 (passed)

      const all = await serverDB.query.agentEvalRunTopics.findMany({
        where: eq(agentEvalRunTopics.runId, runId),
      });
      const statusMap = Object.fromEntries(all.map((r) => [r.topicId, r.status]));
      expect(statusMap[topicId1]).toBe('passed');
      expect(statusMap[topicId2]).toBe('timeout');
    });

    it('should only target running status, not null or pending', async () => {
      const [topic3] = await serverDB
        .insert(topics)
        .values({ userId, title: 'Topic 3', trigger: 'eval', mode: 'test' })
        .returning();

      await serverDB.insert(agentEvalRunTopics).values([
        { userId, runId, topicId: topicId1, testCaseId: testCaseId1 }, // null status
        { userId, runId, topicId: topicId2, testCaseId: testCaseId2, status: 'pending' },
        { userId, runId, topicId: topic3.id, testCaseId: testCaseId1, status: 'running' },
      ]);

      // Backdate all to 30 min ago
      await serverDB
        .update(agentEvalRunTopics)
        .set({ createdAt: sql`NOW() - interval '30 minutes'` })
        .where(eq(agentEvalRunTopics.runId, runId));

      const rows = await runTopicModel.batchMarkTimeout(runId, 1_200_000);

      // Only the running topic should be marked
      expect(rows).toHaveLength(1);

      const all = await serverDB.query.agentEvalRunTopics.findMany({
        where: eq(agentEvalRunTopics.runId, runId),
      });
      const statusMap = Object.fromEntries(all.map((r) => [r.topicId, r.status]));
      expect(statusMap[topicId1]).toBeNull(); // unchanged
      expect(statusMap[topicId2]).toBe('pending'); // unchanged
      expect(statusMap[topic3.id]).toBe('timeout'); // timed out
    });

    it('should return 0 when no topics need timeout', async () => {
      // All topics are recent (just created)
      await serverDB.insert(agentEvalRunTopics).values([
        { userId, runId, topicId: topicId1, testCaseId: testCaseId1, status: 'running' },
        { userId, runId, topicId: topicId2, testCaseId: testCaseId2, status: 'running' },
      ]);

      const rows = await runTopicModel.batchMarkTimeout(runId, 1_200_000);

      expect(rows).toHaveLength(0);
    });

    it('should not affect topics from other runs', async () => {
      const [otherRun] = await serverDB
        .insert(agentEvalRuns)
        .values({ datasetId, userId, status: 'running' })
        .returning();
      const [otherTopic] = await serverDB
        .insert(topics)
        .values({ userId, title: 'Other', trigger: 'eval' })
        .returning();

      await serverDB.insert(agentEvalRunTopics).values([
        { userId, runId, topicId: topicId1, testCaseId: testCaseId1, status: 'running' },
        {
          userId,
          runId: otherRun.id,
          topicId: otherTopic.id,
          testCaseId: testCaseId1,
          status: 'running',
        },
      ]);

      // Backdate both
      await serverDB
        .update(agentEvalRunTopics)
        .set({ createdAt: sql`NOW() - interval '30 minutes'` });

      const rows = await runTopicModel.batchMarkTimeout(runId, 1_200_000);

      expect(rows).toHaveLength(1);

      // Other run's topic should still be running
      const [otherRow] = await serverDB.query.agentEvalRunTopics.findMany({
        where: eq(agentEvalRunTopics.topicId, otherTopic.id),
      });
      expect(otherRow.status).toBe('running');
    });
  });

  describe('deleteErrorRunTopics', () => {
    it('should delete only error and timeout RunTopics', async () => {
      await serverDB.insert(agentEvalRunTopics).values([
        { userId, runId, topicId: topicId1, testCaseId: testCaseId1, status: 'passed' },
        { userId, runId, topicId: topicId2, testCaseId: testCaseId2, status: 'error' },
      ]);

      const deleted = await runTopicModel.deleteErrorRunTopics(runId);

      expect(deleted).toHaveLength(1);
      expect(deleted[0].topicId).toBe(topicId2);

      const remaining = await serverDB.query.agentEvalRunTopics.findMany({
        where: eq(agentEvalRunTopics.runId, runId),
      });
      expect(remaining).toHaveLength(1);
      expect(remaining[0].status).toBe('passed');
    });

    it('should delete both error and timeout statuses', async () => {
      const [topic3] = await serverDB
        .insert(topics)
        .values({ userId, title: 'Topic 3', trigger: 'eval', mode: 'test' })
        .returning();
      const [testCase3] = await serverDB
        .insert(agentEvalTestCases)
        .values({ userId, datasetId, content: { input: 'Q3' }, sortOrder: 3 })
        .returning();

      await serverDB.insert(agentEvalRunTopics).values([
        { userId, runId, topicId: topicId1, testCaseId: testCaseId1, status: 'error' },
        { userId, runId, topicId: topicId2, testCaseId: testCaseId2, status: 'timeout' },
        { userId, runId, topicId: topic3.id, testCaseId: testCase3.id, status: 'failed' },
      ]);

      const deleted = await runTopicModel.deleteErrorRunTopics(runId);

      expect(deleted).toHaveLength(2);

      const remaining = await serverDB.query.agentEvalRunTopics.findMany({
        where: eq(agentEvalRunTopics.runId, runId),
      });
      expect(remaining).toHaveLength(1);
      expect(remaining[0].status).toBe('failed');
    });

    it('should return empty array when no error/timeout topics exist', async () => {
      await serverDB.insert(agentEvalRunTopics).values([
        { userId, runId, topicId: topicId1, testCaseId: testCaseId1, status: 'passed' },
        { userId, runId, topicId: topicId2, testCaseId: testCaseId2, status: 'failed' },
      ]);

      const deleted = await runTopicModel.deleteErrorRunTopics(runId);

      expect(deleted).toHaveLength(0);
    });

    it('should not affect other runs', async () => {
      const [otherRun] = await serverDB
        .insert(agentEvalRuns)
        .values({ datasetId, userId, status: 'completed' })
        .returning();
      const [otherTopic] = await serverDB
        .insert(topics)
        .values({ userId, title: 'Other', trigger: 'eval' })
        .returning();

      await serverDB.insert(agentEvalRunTopics).values([
        { userId, runId, topicId: topicId1, testCaseId: testCaseId1, status: 'error' },
        {
          userId,
          runId: otherRun.id,
          topicId: otherTopic.id,
          testCaseId: testCaseId1,
          status: 'error',
        },
      ]);

      await runTopicModel.deleteErrorRunTopics(runId);

      // Other run's error topic should still exist
      const otherRunTopics = await serverDB.query.agentEvalRunTopics.findMany({
        where: eq(agentEvalRunTopics.runId, otherRun.id),
      });
      expect(otherRunTopics).toHaveLength(1);
      expect(otherRunTopics[0].status).toBe('error');
    });
  });

  describe('cascade deletion', () => {
    beforeEach(async () => {
      await serverDB.insert(agentEvalRunTopics).values({
        userId,
        runId,
        topicId: topicId1,
        testCaseId: testCaseId1,
      });
    });

    it('should cascade delete when run is deleted', async () => {
      await serverDB.delete(agentEvalRuns).where(eq(agentEvalRuns.id, runId));

      const remaining = await serverDB.query.agentEvalRunTopics.findMany({
        where: eq(agentEvalRunTopics.runId, runId),
      });

      expect(remaining).toHaveLength(0);
    });

    it('should cascade delete when topic is deleted', async () => {
      await serverDB.delete(topics).where(eq(topics.id, topicId1));

      const remaining = await serverDB.query.agentEvalRunTopics.findMany({
        where: eq(agentEvalRunTopics.topicId, topicId1),
      });

      expect(remaining).toHaveLength(0);
    });

    it('should cascade delete when test case is deleted', async () => {
      await serverDB.delete(agentEvalTestCases).where(eq(agentEvalTestCases.id, testCaseId1));

      const remaining = await serverDB.query.agentEvalRunTopics.findMany({
        where: eq(agentEvalRunTopics.testCaseId, testCaseId1),
      });

      expect(remaining).toHaveLength(0);
    });
  });
});
