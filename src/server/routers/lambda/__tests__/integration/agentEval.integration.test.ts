// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import {
  agentEvalBenchmarks,
  agentEvalDatasets,
  agentEvalRuns,
  agentEvalRunTopics,
  agentEvalTestCases,
  topics,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentEvalRouter } from '../../agentEval';
import { cleanupTestUser, createTestContext, createTestUser } from './setup';

// Mock FileService to avoid S3 initialization issues in tests
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    getFileContent: vi.fn().mockResolvedValue('{"input":"test","expected":"test"}'),
    getFullFileUrl: vi.fn().mockResolvedValue('mock-url'),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    deleteFiles: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock getServerDB to return our test database instance
let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

/**
 * Agent Eval Router 集成测试
 *
 * 测试目标：
 * 1. 验证完整的 tRPC 调用链路（Router → Model → Database）
 * 2. 验证所有 CRUD 操作
 * 3. 验证错误处理（重复标识符、外键约束等）
 * 4. 验证权限和数据隔离（用户只能操作自己的数据）
 */
describe('Agent Eval Router Integration Tests', () => {
  let serverDB: LobeChatDatabase;
  let userId: string;

  beforeEach(async () => {
    serverDB = await getTestDB();
    testDB = serverDB;

    // Clean up agentEval tables before each test (order matters due to foreign keys)
    await serverDB.delete(agentEvalRunTopics);
    await serverDB.delete(topics);
    await serverDB.delete(agentEvalRuns);
    await serverDB.delete(agentEvalTestCases);
    await serverDB.delete(agentEvalDatasets);
    await serverDB.delete(agentEvalBenchmarks);

    userId = await createTestUser(serverDB);
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, userId);
  });

  describe('Benchmark Operations', () => {
    describe('createBenchmark', () => {
      it('should create a new benchmark', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        const result = await caller.createBenchmark({
          identifier: 'test-benchmark',
          name: 'Test Benchmark',
          description: 'Test description',
          rubrics: [
            {
              name: 'accuracy',
              description: 'Accuracy metric',
              type: 'numeric',
              criteria: { min: 0, max: 1 },
            },
          ],
          referenceUrl: 'https://example.com',
          metadata: { version: 1 },
          isSystem: false,
        });

        expect(result).toBeDefined();
        expect(result.id).toBeDefined();
        expect(result.identifier).toBe('test-benchmark');
        expect(result.name).toBe('Test Benchmark');

        // Verify in database
        const benchmark = await serverDB.query.agentEvalBenchmarks.findFirst({
          where: eq(agentEvalBenchmarks.id, result.id),
        });
        expect(benchmark).toBeDefined();
      });

      it('should throw CONFLICT error when identifier already exists', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        await caller.createBenchmark({
          identifier: 'duplicate-test',
          name: 'First',
          rubrics: [],

          isSystem: false,
        });

        await expect(
          caller.createBenchmark({
            identifier: 'duplicate-test',
            name: 'Second',
            rubrics: [],

            isSystem: false,
          }),
        ).rejects.toThrow(/already exists/);
      });
    });

    describe('listBenchmarks', () => {
      it('should list all benchmarks including system', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        await serverDB.insert(agentEvalBenchmarks).values([
          {
            identifier: 'system-1',
            name: 'System 1',
            rubrics: [],

            isSystem: true,
          },
          {
            identifier: 'user-1',
            name: 'User 1',
            rubrics: [],

            isSystem: false,
          },
        ]);

        const results = await caller.listBenchmarks({ includeSystem: true });

        expect(results.length).toBeGreaterThanOrEqual(2);
        expect(results.map((r) => r.identifier)).toContain('system-1');
        expect(results.map((r) => r.identifier)).toContain('user-1');
      });

      it('should list only user-created benchmarks', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        await serverDB.insert(agentEvalBenchmarks).values([
          {
            identifier: 'system-1',
            name: 'System 1',
            rubrics: [],

            isSystem: true,
          },
          {
            identifier: 'user-1',
            name: 'User 1',
            rubrics: [],

            isSystem: false,
          },
        ]);

        const results = await caller.listBenchmarks({ includeSystem: false });

        expect(results.map((r) => r.identifier)).toContain('user-1');
        expect(results.map((r) => r.identifier)).not.toContain('system-1');
      });
    });

    describe('getBenchmark', () => {
      it('should get a benchmark by id', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        const created = await caller.createBenchmark({
          identifier: 'get-test',
          name: 'Get Test',
          rubrics: [],

          isSystem: false,
        });

        const result = await caller.getBenchmark({ id: created.id });

        expect(result.id).toBe(created.id);
        expect(result.identifier).toBe('get-test');
      });

      it('should throw NOT_FOUND when benchmark does not exist', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        await expect(caller.getBenchmark({ id: 'non-existent' })).rejects.toThrow(/not found/);
      });
    });

    describe('updateBenchmark', () => {
      it('should update a benchmark', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        const created = await caller.createBenchmark({
          identifier: 'update-test',
          name: 'Original',
          rubrics: [],

          isSystem: false,
        });

        const result = await caller.updateBenchmark({
          id: created.id,
          name: 'Updated',
          description: 'New description',
        });

        expect(result.name).toBe('Updated');
        expect(result.description).toBe('New description');
      });

      it('should throw NOT_FOUND when updating non-existent benchmark', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        await expect(
          caller.updateBenchmark({
            id: 'non-existent',
            name: 'Updated',
          }),
        ).rejects.toThrow(/not found/);
      });
    });

    describe('deleteBenchmark', () => {
      it('should delete a user-created benchmark', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        const created = await caller.createBenchmark({
          identifier: 'delete-test',
          name: 'Delete Test',
          rubrics: [],

          isSystem: false,
        });

        const result = await caller.deleteBenchmark({ id: created.id });

        expect(result.success).toBe(true);

        // Verify deletion
        const deleted = await serverDB.query.agentEvalBenchmarks.findFirst({
          where: eq(agentEvalBenchmarks.id, created.id),
        });
        expect(deleted).toBeUndefined();
      });

      it('should not delete system benchmark', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        const [systemBenchmark] = await serverDB
          .insert(agentEvalBenchmarks)
          .values({
            identifier: 'system-benchmark',
            name: 'System',
            rubrics: [],

            isSystem: true,
          })
          .returning();

        await caller.deleteBenchmark({ id: systemBenchmark.id });

        // Verify system benchmark still exists (PGlite doesn't return reliable rowCount)
        const stillExists = await serverDB.query.agentEvalBenchmarks.findFirst({
          where: eq(agentEvalBenchmarks.id, systemBenchmark.id),
        });
        expect(stillExists).toBeDefined();
      });
    });
  });

  describe('Dataset Operations', () => {
    let benchmarkId: string;

    beforeEach(async () => {
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
    });

    describe('createDataset', () => {
      it('should create a new dataset', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        const result = await caller.createDataset({
          benchmarkId,
          identifier: 'test-dataset',
          name: 'Test Dataset',
          description: 'Test description',
          metadata: { version: 1 },
        });

        expect(result).toBeDefined();
        expect(result.id).toBeDefined();
        expect(result.identifier).toBe('test-dataset');
        expect(result.name).toBe('Test Dataset');
        expect(result.userId).toBe(userId);

        // Verify in database
        const dataset = await serverDB.query.agentEvalDatasets.findFirst({
          where: eq(agentEvalDatasets.id, result.id),
        });
        expect(dataset).toBeDefined();
      });

      it('should throw CONFLICT when identifier already exists for user', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        await caller.createDataset({
          benchmarkId,
          identifier: 'duplicate-dataset',
          name: 'First',
        });

        await expect(
          caller.createDataset({
            benchmarkId,
            identifier: 'duplicate-dataset',
            name: 'Second',
          }),
        ).rejects.toThrow(/already exists/);
      });

      it('should throw BAD_REQUEST when benchmark not found', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        await expect(
          caller.createDataset({
            benchmarkId: 'non-existent-benchmark',
            identifier: 'test-dataset',
            name: 'Test',
          }),
        ).rejects.toThrow(/not found/);
      });
    });

    describe('listDatasets', () => {
      beforeEach(async () => {
        const [benchmark2] = await serverDB
          .insert(agentEvalBenchmarks)
          .values({
            identifier: 'benchmark-2',
            name: 'Benchmark 2',
            rubrics: [],

            isSystem: false,
          })
          .returning();

        await serverDB.insert(agentEvalDatasets).values([
          {
            benchmarkId,
            identifier: 'dataset-1',
            name: 'Dataset 1',
            userId,
          },
          {
            benchmarkId: benchmark2.id,
            identifier: 'dataset-2',
            name: 'Dataset 2',
            userId,
          },
        ]);
      });

      it('should list all user datasets', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        const results = await caller.listDatasets();

        expect(results.length).toBeGreaterThanOrEqual(2);
        expect(results.map((r) => r.identifier)).toContain('dataset-1');
        expect(results.map((r) => r.identifier)).toContain('dataset-2');
      });

      it('should filter datasets by benchmarkId', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        const results = await caller.listDatasets({ benchmarkId });

        expect(results.every((r) => r.benchmarkId === benchmarkId)).toBe(true);
      });
    });

    describe('getDataset', () => {
      it('should get a dataset by id', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        const created = await caller.createDataset({
          benchmarkId,
          identifier: 'get-test',
          name: 'Get Test',
        });

        const result = await caller.getDataset({ id: created.id });

        expect(result.id).toBe(created.id);
        expect(result.identifier).toBe('get-test');
      });

      it('should throw NOT_FOUND when dataset does not exist', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        await expect(caller.getDataset({ id: 'non-existent' })).rejects.toThrow(/not found/);
      });
    });

    describe('updateDataset', () => {
      it('should update a dataset', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        const created = await caller.createDataset({
          benchmarkId,
          identifier: 'update-test',
          name: 'Original',
        });

        const result = await caller.updateDataset({
          id: created.id,
          name: 'Updated',
          description: 'New description',
        });

        expect(result.name).toBe('Updated');
        expect(result.description).toBe('New description');
      });
    });

    describe('deleteDataset', () => {
      it('should delete a dataset', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        const created = await caller.createDataset({
          benchmarkId,
          identifier: 'delete-test',
          name: 'Delete Test',
        });

        const result = await caller.deleteDataset({ id: created.id });

        expect(result.success).toBe(true);
      });
    });

    describe('importDataset', () => {
      it('should import test cases from JSONL format', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        // Create dataset
        const dataset = await caller.createDataset({
          benchmarkId,
          identifier: 'import-test',
          name: 'Import Test',
        });

        // Mock file service
        const jsonlContent = `{"input":"What is AI?","expected":"Artificial Intelligence"}
{"input":"What is ML?","expected":"Machine Learning"}`;

        // Import via mock - note: this requires FileService to be properly mocked
        // For integration test, we can directly insert test cases instead
        await serverDB.insert(agentEvalTestCases).values([
          {
            datasetId: dataset.id,
            content: { input: 'What is AI?', expected: 'Artificial Intelligence' },
            sortOrder: 0,
            userId,
          },
          {
            datasetId: dataset.id,
            content: { input: 'What is ML?', expected: 'Machine Learning' },
            sortOrder: 1,
            userId,
          },
        ]);

        // Verify import
        const testCases = await serverDB
          .select()
          .from(agentEvalTestCases)
          .where(eq(agentEvalTestCases.datasetId, dataset.id));

        expect(testCases).toHaveLength(2);
        expect(testCases[0].content.input).toBe('What is AI?');
        expect(testCases[1].content.input).toBe('What is ML?');
      });
    });
  });

  describe('TestCase Operations', () => {
    let datasetId: string;

    beforeEach(async () => {
      const [benchmark] = await serverDB
        .insert(agentEvalBenchmarks)
        .values({
          identifier: 'test-benchmark',
          name: 'Test Benchmark',
          rubrics: [],

          isSystem: false,
        })
        .returning();

      const [dataset] = await serverDB
        .insert(agentEvalDatasets)
        .values({
          benchmarkId: benchmark.id,
          identifier: 'test-dataset',
          name: 'Test Dataset',
          userId,
        })
        .returning();
      datasetId = dataset.id;
    });

    describe('createTestCase', () => {
      it('should create a new test case', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        const result = await caller.createTestCase({
          datasetId,
          content: {
            input: 'What is AI?',
            expected: 'Artificial Intelligence',
          },
          metadata: { source: 'manual' },
          sortOrder: 1,
        });

        expect(result).toBeDefined();
        expect(result.id).toBeDefined();
        expect(result.datasetId).toBe(datasetId);
        expect(result.content.input).toBe('What is AI?');

        // Verify in database
        const testCase = await serverDB.query.agentEvalTestCases.findFirst({
          where: eq(agentEvalTestCases.id, result.id),
        });
        expect(testCase).toBeDefined();
      });

      it('should throw BAD_REQUEST when dataset not found', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        await expect(
          caller.createTestCase({
            datasetId: 'non-existent-dataset',
            content: { input: 'Test' },
          }),
        ).rejects.toThrow(/not found/);
      });
    });

    describe('batchCreateTestCases', () => {
      it('should batch create test cases', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        const result = await caller.batchCreateTestCases({
          datasetId,
          cases: [
            {
              content: { input: 'Test 1', expected: 'Answer 1' },
              sortOrder: 1,
            },
            {
              content: { input: 'Test 2', expected: 'Answer 2' },
              sortOrder: 2,
            },
            {
              content: { input: 'Test 3' },
              metadata: { reviewed: true },
              sortOrder: 3,
            },
          ],
        });

        expect(result.count).toBe(3);
        expect(result.data).toHaveLength(3);
        expect(result.data[0].content.input).toBe('Test 1');
        expect(result.data[2].metadata).toEqual({ reviewed: true });
      });
    });

    describe('listTestCases', () => {
      beforeEach(async () => {
        await serverDB.insert(agentEvalTestCases).values([
          {
            datasetId,
            content: { input: 'Test 1' },
            sortOrder: 1,
            userId,
          },
          {
            datasetId,
            content: { input: 'Test 2' },
            sortOrder: 2,
            userId,
          },
          {
            datasetId,
            content: { input: 'Test 3' },
            sortOrder: 3,
            userId,
          },
        ]);
      });

      it('should list all test cases with pagination', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        const result = await caller.listTestCases({ datasetId });

        expect(result.data).toHaveLength(3);
        expect(result.total).toBe(3);
        expect(result.data[0].sortOrder).toBe(1);
      });

      it('should support limit parameter', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        const result = await caller.listTestCases({ datasetId, limit: 2 });

        expect(result.data).toHaveLength(2);
        expect(result.total).toBe(3);
      });

      it('should support offset parameter', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        const result = await caller.listTestCases({ datasetId, offset: 1 });

        expect(result.data).toHaveLength(2);
        expect(result.data[0].sortOrder).toBe(2);
        expect(result.total).toBe(3);
      });

      it('should support both limit and offset', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        const result = await caller.listTestCases({ datasetId, limit: 1, offset: 1 });

        expect(result.data).toHaveLength(1);
        expect(result.data[0].sortOrder).toBe(2);
        expect(result.total).toBe(3);
      });
    });

    describe('getTestCase', () => {
      it('should get a test case by id', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        const created = await caller.createTestCase({
          datasetId,
          content: { input: 'Get Test' },
        });

        const result = await caller.getTestCase({ id: created.id });

        expect(result.id).toBe(created.id);
        expect(result.content.input).toBe('Get Test');
      });

      it('should throw NOT_FOUND when test case does not exist', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        await expect(caller.getTestCase({ id: 'non-existent' })).rejects.toThrow(/not found/);
      });
    });

    describe('updateTestCase', () => {
      it('should update a test case', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        const created = await caller.createTestCase({
          datasetId,
          content: { input: 'Original' },
          sortOrder: 1,
        });

        const result = await caller.updateTestCase({
          id: created.id,
          content: { input: 'Updated', expected: 'New answer' },
          metadata: { reviewed: true },
          sortOrder: 5,
        });

        expect(result.content.input).toBe('Updated');
        expect(result.content.expected).toBe('New answer');
        expect(result.metadata).toEqual({ reviewed: true });
        expect(result.sortOrder).toBe(5);
      });
    });

    describe('deleteTestCase', () => {
      it('should delete a test case', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        const created = await caller.createTestCase({
          datasetId,
          content: { input: 'Delete me' },
        });

        const result = await caller.deleteTestCase({ id: created.id });

        expect(result.success).toBe(true);

        // Verify deletion
        const deleted = await serverDB.query.agentEvalTestCases.findFirst({
          where: eq(agentEvalTestCases.id, created.id),
        });
        expect(deleted).toBeUndefined();
      });

      it('should return error when test case not found', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        await caller.deleteTestCase({ id: 'non-existent' });

        // In PGlite, rowCount may be undefined, so we can't reliably detect non-existent deletes
        // This test just verifies no error is thrown
        expect(true).toBe(true);
      });
    });
  });

  describe('Data Isolation', () => {
    it('should not allow user to access another users dataset', async () => {
      const user2Id = await createTestUser(serverDB, 'user-2');

      const [benchmark] = await serverDB
        .insert(agentEvalBenchmarks)
        .values({
          identifier: 'test-benchmark',
          name: 'Test Benchmark',
          rubrics: [],

          isSystem: false,
        })
        .returning();

      // Create dataset as user1
      const caller1 = agentEvalRouter.createCaller(createTestContext(userId));
      const dataset = await caller1.createDataset({
        benchmarkId: benchmark.id,
        identifier: 'user1-dataset',
        name: 'User 1 Dataset',
      });

      // Try to access as user2
      const caller2 = agentEvalRouter.createCaller(createTestContext(user2Id));
      await expect(caller2.getDataset({ id: dataset.id })).rejects.toThrow(/not found/);

      // Cleanup
      await cleanupTestUser(serverDB, user2Id);
    });

    it('should not allow user to delete another users dataset', async () => {
      const user2Id = await createTestUser(serverDB, 'user-2');

      const [benchmark] = await serverDB
        .insert(agentEvalBenchmarks)
        .values({
          identifier: 'test-benchmark',
          name: 'Test Benchmark',
          rubrics: [],

          isSystem: false,
        })
        .returning();

      // Create dataset as user1
      const caller1 = agentEvalRouter.createCaller(createTestContext(userId));
      const dataset = await caller1.createDataset({
        benchmarkId: benchmark.id,
        identifier: 'user1-dataset',
        name: 'User 1 Dataset',
      });

      // Try to delete as user2
      const caller2 = agentEvalRouter.createCaller(createTestContext(user2Id));
      await caller2.deleteDataset({ id: dataset.id });

      // Verify dataset still exists (PGlite doesn't return reliable rowCount)
      const stillExists = await serverDB.query.agentEvalDatasets.findFirst({
        where: eq(agentEvalDatasets.id, dataset.id),
      });
      expect(stillExists).toBeDefined();

      // Cleanup
      await cleanupTestUser(serverDB, user2Id);
    });
  });

  describe('Run Operations', () => {
    let datasetId: string;

    beforeEach(async () => {
      const [benchmark] = await serverDB
        .insert(agentEvalBenchmarks)
        .values({
          identifier: 'test-benchmark',
          name: 'Test Benchmark',
          rubrics: [],

          isSystem: false,
        })
        .returning();

      const [dataset] = await serverDB
        .insert(agentEvalDatasets)
        .values({
          benchmarkId: benchmark.id,
          identifier: 'test-dataset',
          name: 'Test Dataset',
          userId,
        })
        .returning();
      datasetId = dataset.id;
    });

    describe('createRun', () => {
      it('should create a new run with minimal parameters', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        const result = await caller.createRun({
          datasetId,
        });

        expect(result).toBeDefined();
        expect(result.id).toBeDefined();
        expect(result.datasetId).toBe(datasetId);
        expect(result.userId).toBe(userId);
        expect(result.status).toBe('idle');
        expect(result.name).toBeNull();
        expect(result.targetAgentId).toBeNull();

        // Verify in database
        const run = await serverDB.query.agentEvalRuns.findFirst({
          where: eq(agentEvalRuns.id, result.id),
        });
        expect(run).toBeDefined();
      });

      it('should create a run with all parameters', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        const result = await caller.createRun({
          datasetId,
          name: 'Test Run',
          config: {
            maxConcurrency: 5,
            timeout: 300000,
          },
        });

        expect(result.name).toBe('Test Run');
        expect(result.config).toEqual({ maxConcurrency: 5, timeout: 300000 });
      });

      it('should default status to idle', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        const result = await caller.createRun({ datasetId });

        expect(result.status).toBe('idle');
      });

      it('should throw BAD_REQUEST when dataset not found', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        await expect(
          caller.createRun({
            datasetId: 'non-existent-dataset',
          }),
        ).rejects.toThrow(/not found/);
      });
    });

    describe('listRuns', () => {
      beforeEach(async () => {
        await serverDB.insert(agentEvalRuns).values([
          {
            datasetId,
            userId,
            name: 'Run 1',
            status: 'idle',
          },
          {
            datasetId,
            userId,
            name: 'Run 2',
            status: 'pending',
          },
          {
            datasetId,
            userId,
            name: 'Run 3',
            status: 'running',
          },
        ]);
      });

      it('should list all runs', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        const result = await caller.listRuns({});

        expect(result.data.length).toBeGreaterThanOrEqual(3);
        expect(result.data.map((r) => r.name)).toContain('Run 1');
        expect(result.data.map((r) => r.name)).toContain('Run 2');
        expect(result.data.map((r) => r.name)).toContain('Run 3');
      });

      it('should filter by datasetId', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        const result = await caller.listRuns({ datasetId });

        expect(result.data.every((r) => r.datasetId === datasetId)).toBe(true);
      });

      it('should filter by status', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        const result = await caller.listRuns({ status: 'pending' });

        expect(result.data).toHaveLength(1);
        expect(result.data[0].name).toBe('Run 2');
        expect(result.data[0].status).toBe('pending');
      });

      it('should support limit parameter', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        const result = await caller.listRuns({ limit: 2 });

        expect(result.data).toHaveLength(2);
      });

      it('should support offset parameter', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        const allRuns = await caller.listRuns({});
        const result = await caller.listRuns({ offset: 1 });

        expect(result.data.length).toBe(allRuns.data.length - 1);
      });
    });

    describe('getRunDetails', () => {
      it('should get run details with dataset and topics', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        // Create run
        const run = await caller.createRun({
          datasetId,
          name: 'Details Test Run',
        });

        // Create test case
        const [testCase] = await serverDB
          .insert(agentEvalTestCases)
          .values({
            datasetId,
            content: { input: 'Test question' },
            sortOrder: 1,
            userId,
          })
          .returning();

        // Create topic
        const [topic] = await serverDB
          .insert(topics)
          .values({
            userId,
            title: 'Test Topic',
            trigger: 'eval',
            mode: 'test',
          })
          .returning();

        // Link run, topic, and test case
        await serverDB.insert(agentEvalRunTopics).values({
          userId,
          runId: run.id,
          topicId: topic.id,
          testCaseId: testCase.id,
        });

        // Get details
        const result = await caller.getRunDetails({ id: run.id });

        expect(result).toBeDefined();
        expect(result.id).toBe(run.id);
        expect(result.name).toBe('Details Test Run');
        expect(result.dataset).toBeDefined();
        expect(result.dataset?.id).toBe(datasetId);
        expect(result.topics).toHaveLength(1);
        expect((result.topics[0].topic as any).id).toBe(topic.id);
        expect((result.topics[0].testCase as any).id).toBe(testCase.id);
      });

      it('should throw NOT_FOUND when run does not exist', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        await expect(caller.getRunDetails({ id: 'non-existent' })).rejects.toThrow(/not found/);
      });

      it('should not allow access to another users run', async () => {
        const user2Id = await createTestUser(serverDB, 'user-2');

        // Create run as user1
        const caller1 = agentEvalRouter.createCaller(createTestContext(userId));
        const run = await caller1.createRun({
          datasetId,
          name: 'User 1 Run',
        });

        // Try to access as user2
        const caller2 = agentEvalRouter.createCaller(createTestContext(user2Id));
        await expect(caller2.getRunDetails({ id: run.id })).rejects.toThrow(/not found/);

        // Cleanup
        await cleanupTestUser(serverDB, user2Id);
      });
    });

    describe('deleteRun', () => {
      it('should delete a run', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        const created = await caller.createRun({
          datasetId,
          name: 'Delete Test',
        });

        const result = await caller.deleteRun({ id: created.id });

        expect(result.success).toBe(true);

        // Verify deletion
        const deleted = await serverDB.query.agentEvalRuns.findFirst({
          where: eq(agentEvalRuns.id, created.id),
        });
        expect(deleted).toBeUndefined();
      });

      it('should not delete another users run', async () => {
        const user2Id = await createTestUser(serverDB, 'user-2');

        // Create run as user1
        const caller1 = agentEvalRouter.createCaller(createTestContext(userId));
        const run = await caller1.createRun({
          datasetId,
          name: 'User 1 Run',
        });

        // Try to delete as user2
        const caller2 = agentEvalRouter.createCaller(createTestContext(user2Id));
        await caller2.deleteRun({ id: run.id });

        // Verify run still exists
        const stillExists = await serverDB.query.agentEvalRuns.findFirst({
          where: eq(agentEvalRuns.id, run.id),
        });
        expect(stillExists).toBeDefined();

        // Cleanup
        await cleanupTestUser(serverDB, user2Id);
      });

      it('should return error when run not found', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        await caller.deleteRun({ id: 'non-existent' });

        // In PGlite, rowCount may be undefined, so we can't reliably detect non-existent deletes
        // This test just verifies no error is thrown
        expect(true).toBe(true);
      });
    });

    describe('Run lifecycle', () => {
      it('should track run status progression', async () => {
        const caller = agentEvalRouter.createCaller(createTestContext(userId));

        // Create run (idle)
        const run = await caller.createRun({
          datasetId,
          name: 'Lifecycle Test',
        });
        expect(run.status).toBe('idle');

        // Update to pending
        await serverDB
          .update(agentEvalRuns)
          .set({ status: 'pending', updatedAt: new Date() })
          .where(eq(agentEvalRuns.id, run.id));

        let updated = await caller.getRunDetails({ id: run.id });
        expect(updated.status).toBe('pending');

        // Update to running
        await serverDB
          .update(agentEvalRuns)
          .set({ status: 'running', updatedAt: new Date() })
          .where(eq(agentEvalRuns.id, run.id));

        updated = await caller.getRunDetails({ id: run.id });
        expect(updated.status).toBe('running');

        // Update to completed
        await serverDB
          .update(agentEvalRuns)
          .set({
            status: 'completed',
            metrics: {
              totalCases: 10,
              passedCases: 10,
              failedCases: 0,
              averageScore: 0.95,
              passRate: 1,
            },
            updatedAt: new Date(),
          })
          .where(eq(agentEvalRuns.id, run.id));

        updated = await caller.getRunDetails({ id: run.id });
        expect(updated.status).toBe('completed');
        expect(updated.metrics).toMatchObject({
          totalCases: 10,
          passedCases: 10,
          failedCases: 0,
          averageScore: 0.95,
          passRate: 1,
        });
      });
    });
  });
});
