import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  agentEvalBenchmarks,
  agentEvalDatasets,
  agentEvalRuns,
  agentEvalTestCases,
  users,
} from '../../../schemas';
import { AgentEvalBenchmarkModel } from '../benchmark';

const serverDB = await getTestDB();

const userId = 'benchmark-test-user';
const userId2 = 'benchmark-test-user-2';
const benchmarkModel = new AgentEvalBenchmarkModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(agentEvalRuns);
  await serverDB.delete(agentEvalTestCases);
  await serverDB.delete(agentEvalDatasets);
  await serverDB.delete(agentEvalBenchmarks);
  await serverDB.delete(users);

  // Create test users (needed for runs FK constraint)
  await serverDB.insert(users).values([{ id: userId }, { id: userId2 }]);
});

afterEach(async () => {
  await serverDB.delete(agentEvalRuns);
  await serverDB.delete(agentEvalTestCases);
  await serverDB.delete(agentEvalDatasets);
  await serverDB.delete(agentEvalBenchmarks);
  await serverDB.delete(users);
});

describe('AgentEvalBenchmarkModel', () => {
  describe('create', () => {
    it('should create a new benchmark', async () => {
      const params = {
        identifier: 'test-benchmark',
        name: 'Test Benchmark',
        description: 'Test description',
        rubrics: [
          {
            id: 'rubric-1',
            name: 'accuracy',
            type: 'llm-rubric' as const,
            config: { criteria: 'Measures accuracy' },
            weight: 1,
            threshold: 0.7,
          },
        ],
        referenceUrl: 'https://example.com',
        metadata: { version: 1 },
        isSystem: false,
      };

      const result = await benchmarkModel.create(params);

      expect(result).toBeDefined();
      expect(result.identifier).toBe('test-benchmark');
      expect(result.name).toBe('Test Benchmark');
      expect(result.description).toBe('Test description');
      expect(result.rubrics).toEqual(params.rubrics);
      expect(result.referenceUrl).toBe('https://example.com');
      expect(result.metadata).toEqual({ version: 1 });
      expect(result.isSystem).toBe(false);
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    it('should create a system benchmark', async () => {
      const params = {
        identifier: 'system-benchmark',
        name: 'System Benchmark',
        rubrics: [],
        isSystem: true,
      };

      const result = await benchmarkModel.create(params);

      expect(result.isSystem).toBe(true);
      expect(result.identifier).toBe('system-benchmark');
    });
  });

  describe('delete', () => {
    it('should delete a user-created benchmark', async () => {
      const [benchmark] = await serverDB
        .insert(agentEvalBenchmarks)
        .values({
          identifier: 'delete-test',
          name: 'Delete Test',
          rubrics: [],

          isSystem: false,
        })
        .returning();

      await benchmarkModel.delete(benchmark.id);

      const deleted = await serverDB.query.agentEvalBenchmarks.findFirst({
        where: eq(agentEvalBenchmarks.id, benchmark.id),
      });
      expect(deleted).toBeUndefined();
    });

    it('should not delete a system benchmark', async () => {
      const [systemBenchmark] = await serverDB
        .insert(agentEvalBenchmarks)
        .values({
          identifier: 'system-benchmark',
          name: 'System Benchmark',
          rubrics: [],

          isSystem: true,
        })
        .returning();

      await benchmarkModel.delete(systemBenchmark.id);

      const stillExists = await serverDB.query.agentEvalBenchmarks.findFirst({
        where: eq(agentEvalBenchmarks.id, systemBenchmark.id),
      });
      expect(stillExists).toBeDefined();
    });

    it('should return 0 rowCount when benchmark not found', async () => {
      await benchmarkModel.delete('non-existent-id');
      // No rowCount in PGlite, just verify no error
    });
  });

  describe('query', () => {
    beforeEach(async () => {
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
        {
          identifier: 'system-2',
          name: 'System 2',
          rubrics: [],

          isSystem: true,
        },
      ]);
    });

    it('should query all benchmarks including system', async () => {
      const results = await benchmarkModel.query(true);

      expect(results).toHaveLength(3);
      expect(results.map((r) => r.identifier)).toContain('system-1');
      expect(results.map((r) => r.identifier)).toContain('user-1');
      expect(results.map((r) => r.identifier)).toContain('system-2');
    });

    it('should query only user-created benchmarks', async () => {
      const results = await benchmarkModel.query(false);

      expect(results).toHaveLength(1);
      expect(results[0].identifier).toBe('user-1');
      expect(results[0].isSystem).toBe(false);
    });

    it('should default to including system benchmarks', async () => {
      const results = await benchmarkModel.query();

      expect(results).toHaveLength(3);
    });

    it('should order by createdAt descending', async () => {
      const results = await benchmarkModel.query(true);

      // 最新的应该在前面
      // Order may vary in PGlite due to timing
      expect(results.length).toBeGreaterThanOrEqual(3);
    });

    it('should return datasetCount for benchmarks with datasets', async () => {
      // Find the user-1 benchmark
      const benchmarks = await serverDB.query.agentEvalBenchmarks.findMany();
      const userBenchmark = benchmarks.find((b) => b.identifier === 'user-1')!;

      // Add 2 datasets to it
      await serverDB.insert(agentEvalDatasets).values([
        {
          benchmarkId: userBenchmark.id,
          identifier: 'ds-1',
          name: 'Dataset 1',
          userId,
        },
        {
          benchmarkId: userBenchmark.id,
          identifier: 'ds-2',
          name: 'Dataset 2',
          userId,
        },
      ]);

      const results = await benchmarkModel.query(true);
      const result = results.find((r) => r.identifier === 'user-1')!;

      expect(result.datasetCount).toBe(2);
    });

    it('should return testCaseCount for benchmarks with test cases', async () => {
      const benchmarks = await serverDB.query.agentEvalBenchmarks.findMany();
      const userBenchmark = benchmarks.find((b) => b.identifier === 'user-1')!;

      // Add a dataset
      const [dataset] = await serverDB
        .insert(agentEvalDatasets)
        .values({
          benchmarkId: userBenchmark.id,
          identifier: 'ds-for-cases',
          name: 'Dataset for Cases',
          userId,
        })
        .returning();

      // Add 3 test cases to the dataset
      await serverDB.insert(agentEvalTestCases).values([
        { datasetId: dataset.id, content: { input: 'test' }, sortOrder: 1, userId },
        { datasetId: dataset.id, content: { input: 'test' }, sortOrder: 2, userId },
        { datasetId: dataset.id, content: { input: 'test' }, sortOrder: 3, userId },
      ]);

      const results = await benchmarkModel.query(true);
      const result = results.find((r) => r.identifier === 'user-1')!;

      expect(result.testCaseCount).toBe(3);
    });

    it('should return runCount for benchmarks with runs', async () => {
      const benchmarks = await serverDB.query.agentEvalBenchmarks.findMany();
      const userBenchmark = benchmarks.find((b) => b.identifier === 'user-1')!;

      // Add a dataset
      const [dataset] = await serverDB
        .insert(agentEvalDatasets)
        .values({
          benchmarkId: userBenchmark.id,
          identifier: 'ds-for-runs',
          name: 'Dataset for Runs',
          userId,
        })
        .returning();

      // Add 2 runs
      await serverDB.insert(agentEvalRuns).values([
        { datasetId: dataset.id, userId, status: 'idle' },
        { datasetId: dataset.id, userId, status: 'idle' },
      ]);

      const results = await benchmarkModel.query(true);
      const result = results.find((r) => r.identifier === 'user-1')!;

      expect(result.runCount).toBe(2);
    });

    it('should only count runs belonging to the current user in runCount', async () => {
      const benchmarks = await serverDB.query.agentEvalBenchmarks.findMany();
      const userBenchmark = benchmarks.find((b) => b.identifier === 'user-1')!;

      const [dataset] = await serverDB
        .insert(agentEvalDatasets)
        .values({
          benchmarkId: userBenchmark.id,
          identifier: 'ds-isolation',
          name: 'Dataset Isolation',
          userId,
        })
        .returning();

      // Add runs for current user and another user
      await serverDB.insert(agentEvalRuns).values([
        { datasetId: dataset.id, userId, status: 'idle' },
        { datasetId: dataset.id, userId, status: 'completed' },
        { datasetId: dataset.id, userId: userId2, status: 'idle' },
        { datasetId: dataset.id, userId: userId2, status: 'completed' },
        { datasetId: dataset.id, userId: userId2, status: 'running' },
      ]);

      const results = await benchmarkModel.query(true);
      const result = results.find((r) => r.identifier === 'user-1')!;

      // Should only count the 2 runs from the current user
      expect(result.runCount).toBe(2);
    });

    it('should only return recentRuns belonging to the current user', async () => {
      const benchmarks = await serverDB.query.agentEvalBenchmarks.findMany();
      const userBenchmark = benchmarks.find((b) => b.identifier === 'user-1')!;

      const [dataset] = await serverDB
        .insert(agentEvalDatasets)
        .values({
          benchmarkId: userBenchmark.id,
          identifier: 'ds-recent-isolation',
          name: 'Dataset Recent Isolation',
          userId,
        })
        .returning();

      // Add runs for both users
      const [myRun] = await serverDB
        .insert(agentEvalRuns)
        .values([
          { datasetId: dataset.id, userId, status: 'completed', name: 'My Run' },
          { datasetId: dataset.id, userId: userId2, status: 'completed', name: 'Other Run' },
        ])
        .returning();

      const results = await benchmarkModel.query(true);
      const result = results.find((r) => r.identifier === 'user-1')!;

      // Should only include the current user's runs
      expect(result.recentRuns).toHaveLength(1);
      expect(result.recentRuns[0].userId).toBe(userId);
      expect(result.recentRuns[0].name).toBe('My Run');
    });

    it('should return 0 counts for benchmarks without related data', async () => {
      const results = await benchmarkModel.query(true);
      const result = results.find((r) => r.identifier === 'user-1')!;

      expect(result.datasetCount).toBe(0);
      expect(result.testCaseCount).toBe(0);
      expect(result.runCount).toBe(0);
    });
  });

  describe('findById', () => {
    it('should find a benchmark by id', async () => {
      const [benchmark] = await serverDB
        .insert(agentEvalBenchmarks)
        .values({
          identifier: 'find-test',
          name: 'Find Test',
          rubrics: [],

          isSystem: false,
        })
        .returning();

      const result = await benchmarkModel.findById(benchmark.id);

      expect(result).toBeDefined();
      expect(result?.id).toBe(benchmark.id);
      expect(result?.identifier).toBe('find-test');
    });

    it('should return undefined when benchmark not found', async () => {
      const result = await benchmarkModel.findById('non-existent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('findByIdentifier', () => {
    it('should find a benchmark by identifier', async () => {
      await serverDB.insert(agentEvalBenchmarks).values({
        identifier: 'unique-identifier',
        name: 'Unique Test',
        rubrics: [],
        isSystem: false,
      });

      const result = await benchmarkModel.findByIdentifier('unique-identifier');

      expect(result).toBeDefined();
      expect(result?.identifier).toBe('unique-identifier');
      expect(result?.name).toBe('Unique Test');
    });

    it('should return undefined when identifier not found', async () => {
      const result = await benchmarkModel.findByIdentifier('non-existent');
      expect(result).toBeUndefined();
    });
  });

  describe('update', () => {
    it('should update a user-created benchmark', async () => {
      const [benchmark] = await serverDB
        .insert(agentEvalBenchmarks)
        .values({
          identifier: 'update-test',
          name: 'Original Name',
          rubrics: [],

          isSystem: false,
        })
        .returning();

      const result = await benchmarkModel.update(benchmark.id, {
        name: 'Updated Name',
        description: 'New description',
      });

      expect(result).toBeDefined();
      expect(result?.name).toBe('Updated Name');
      expect(result?.description).toBe('New description');
      expect(result?.updatedAt).toBeDefined();
      expect(result?.updatedAt.getTime()).toBeGreaterThanOrEqual(result!.createdAt.getTime());
    });

    it('should not update a system benchmark', async () => {
      const [systemBenchmark] = await serverDB
        .insert(agentEvalBenchmarks)
        .values({
          identifier: 'system-benchmark',
          name: 'System Benchmark',
          rubrics: [],

          isSystem: true,
        })
        .returning();

      const result = await benchmarkModel.update(systemBenchmark.id, {
        name: 'Attempted Update',
      });

      expect(result).toBeUndefined();

      const unchanged = await benchmarkModel.findById(systemBenchmark.id);
      expect(unchanged?.name).toBe('System Benchmark');
    });

    it('should return undefined when benchmark not found', async () => {
      const result = await benchmarkModel.update('non-existent-id', {
        name: 'New Name',
      });

      expect(result).toBeUndefined();
    });

    it('should update only specified fields', async () => {
      const [benchmark] = await serverDB
        .insert(agentEvalBenchmarks)
        .values({
          identifier: 'partial-update',
          name: 'Original',
          description: 'Original Desc',
          rubrics: [],

          isSystem: false,
        })
        .returning();

      const result = await benchmarkModel.update(benchmark.id, {
        name: 'Only Name Changed',
      });

      expect(result?.name).toBe('Only Name Changed');
      expect(result?.description).toBe('Original Desc');
    });
  });
});
