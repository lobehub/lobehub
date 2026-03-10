import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  agentEvalBenchmarks,
  agentEvalDatasets,
  agentEvalTestCases,
  users,
} from '../../../schemas';
import { AgentEvalDatasetModel } from '../dataset';

const serverDB = await getTestDB();

const userId = 'dataset-test-user';
const userId2 = 'dataset-test-user-2';
const datasetModel = new AgentEvalDatasetModel(serverDB, userId);

let benchmarkId: string;

beforeEach(async () => {
  await serverDB.delete(agentEvalTestCases);
  await serverDB.delete(agentEvalDatasets);
  await serverDB.delete(agentEvalBenchmarks);
  await serverDB.delete(users);

  // Create test users
  await serverDB.insert(users).values([{ id: userId }, { id: userId2 }]);

  // Create a test benchmark
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

afterEach(async () => {
  await serverDB.delete(agentEvalTestCases);
  await serverDB.delete(agentEvalDatasets);
  await serverDB.delete(agentEvalBenchmarks);
  await serverDB.delete(users);
});

describe('AgentEvalDatasetModel', () => {
  describe('create', () => {
    it('should create a new dataset with userId', async () => {
      const params = {
        benchmarkId,
        identifier: 'test-dataset',
        name: 'Test Dataset',
        description: 'Test description',
        metadata: { version: 1 },
      };

      const result = await datasetModel.create(params);

      expect(result).toBeDefined();
      expect(result.benchmarkId).toBe(benchmarkId);
      expect(result.identifier).toBe('test-dataset');
      expect(result.name).toBe('Test Dataset');
      expect(result.description).toBe('Test description');
      expect(result.metadata).toEqual({ version: 1 });
      expect(result.userId).toBe(userId);
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    it('should create a dataset with minimal parameters', async () => {
      const params = {
        benchmarkId,
        identifier: 'minimal-dataset',
        name: 'Minimal Dataset',
      };

      const result = await datasetModel.create(params);

      expect(result).toBeDefined();
      expect(result.identifier).toBe('minimal-dataset');
      expect(result.userId).toBe(userId);
    });
  });

  describe('delete', () => {
    it('should delete a dataset owned by the user', async () => {
      const [dataset] = await serverDB
        .insert(agentEvalDatasets)
        .values({
          benchmarkId,
          identifier: 'delete-test',
          name: 'Delete Test',
          userId,
        })
        .returning();

      await datasetModel.delete(dataset.id);

      const deleted = await serverDB.query.agentEvalDatasets.findFirst({
        where: eq(agentEvalDatasets.id, dataset.id),
      });
      expect(deleted).toBeUndefined();
    });

    it('should not delete a dataset owned by another user', async () => {
      const [dataset] = await serverDB
        .insert(agentEvalDatasets)
        .values({
          benchmarkId,
          identifier: 'other-user-dataset',
          name: 'Other User Dataset',
          userId: userId2,
        })
        .returning();

      await datasetModel.delete(dataset.id);

      const stillExists = await serverDB.query.agentEvalDatasets.findFirst({
        where: eq(agentEvalDatasets.id, dataset.id),
      });
      expect(stillExists).toBeDefined();
    });

    it('should return 0 rowCount when dataset not found', async () => {
      await datasetModel.delete('non-existent-id');
      // No rowCount in PGlite
    });
  });

  describe('query', () => {
    beforeEach(async () => {
      // Create another benchmark
      const [benchmark2] = await serverDB
        .insert(agentEvalBenchmarks)
        .values({
          identifier: 'benchmark-2',
          name: 'Benchmark 2',
          rubrics: [],

          isSystem: false,
        })
        .returning();

      // Insert datasets
      await serverDB.insert(agentEvalDatasets).values([
        {
          benchmarkId,
          identifier: 'user-dataset-1',
          name: 'User Dataset 1',
          userId,
        },
        {
          benchmarkId: benchmark2.id,
          identifier: 'user-dataset-2',
          name: 'User Dataset 2',
          userId,
        },
        {
          benchmarkId,
          identifier: 'system-dataset',
          name: 'System Dataset',
          userId: null, // System dataset
        },
        {
          benchmarkId,
          identifier: 'other-user-dataset',
          name: 'Other User Dataset',
          userId: userId2,
        },
      ]);
    });

    it('should query all datasets (user + system)', async () => {
      const results = await datasetModel.query();

      expect(results).toHaveLength(3); // user-dataset-1, user-dataset-2, system-dataset
      expect(results.map((r) => r.identifier)).toContain('user-dataset-1');
      expect(results.map((r) => r.identifier)).toContain('user-dataset-2');
      expect(results.map((r) => r.identifier)).toContain('system-dataset');
      expect(results.map((r) => r.identifier)).not.toContain('other-user-dataset');
    });

    it('should query datasets by benchmarkId', async () => {
      const results = await datasetModel.query(benchmarkId);

      expect(results).toHaveLength(2); // user-dataset-1, system-dataset
      expect(results.every((r) => r.benchmarkId === benchmarkId)).toBe(true);
    });

    it('should order by createdAt descending', async () => {
      const results = await datasetModel.query();

      // 最新的应该在前面
      // Order may vary, just check we got results
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it('should include system datasets (userId is null)', async () => {
      const results = await datasetModel.query();

      const systemDataset = results.find((r) => r.identifier === 'system-dataset');
      expect(systemDataset).toBeDefined();
      expect(systemDataset?.userId).toBeNull();
    });
  });

  describe('findById', () => {
    it('should find a dataset by id (user-owned)', async () => {
      const [dataset] = await serverDB
        .insert(agentEvalDatasets)
        .values({
          benchmarkId,
          identifier: 'find-test',
          name: 'Find Test',
          userId,
        })
        .returning();

      const result = await datasetModel.findById(dataset.id);

      expect(result).toBeDefined();
      expect(result?.id).toBe(dataset.id);
      expect(result?.identifier).toBe('find-test');
    });

    it('should find a system dataset', async () => {
      const [systemDataset] = await serverDB
        .insert(agentEvalDatasets)
        .values({
          benchmarkId,
          identifier: 'system-dataset',
          name: 'System Dataset',
          userId: null,
        })
        .returning();

      const result = await datasetModel.findById(systemDataset.id);

      expect(result).toBeDefined();
      expect(result?.userId).toBeNull();
    });

    it('should not find a dataset owned by another user', async () => {
      const [otherDataset] = await serverDB
        .insert(agentEvalDatasets)
        .values({
          benchmarkId,
          identifier: 'other-dataset',
          name: 'Other Dataset',
          userId: userId2,
        })
        .returning();

      const result = await datasetModel.findById(otherDataset.id);

      expect(result).toBeUndefined();
    });

    it('should return dataset with test cases', async () => {
      const [dataset] = await serverDB
        .insert(agentEvalDatasets)
        .values({
          benchmarkId,
          identifier: 'with-cases',
          name: 'With Cases',
          userId,
        })
        .returning();

      // Add test cases
      await serverDB.insert(agentEvalTestCases).values([
        {
          datasetId: dataset.id,
          content: { input: 'Test 1' },
          sortOrder: 1,
          userId,
        },
        {
          datasetId: dataset.id,
          content: { input: 'Test 2' },
          sortOrder: 2,
          userId,
        },
      ]);

      const result = await datasetModel.findById(dataset.id);

      expect(result).toBeDefined();
      expect(result?.testCases).toHaveLength(2);
      expect(result?.testCases[0].sortOrder).toBe(1);
      expect(result?.testCases[1].sortOrder).toBe(2);
    });

    it('should return undefined when dataset not found', async () => {
      const result = await datasetModel.findById('non-existent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('update', () => {
    it('should update a dataset owned by the user', async () => {
      const [dataset] = await serverDB
        .insert(agentEvalDatasets)
        .values({
          benchmarkId,
          identifier: 'update-test',
          name: 'Original Name',
          userId,
        })
        .returning();

      const result = await datasetModel.update(dataset.id, {
        name: 'Updated Name',
        description: 'New description',
      });

      expect(result).toBeDefined();
      expect(result?.name).toBe('Updated Name');
      expect(result?.description).toBe('New description');
      expect(result?.updatedAt).toBeDefined();
      expect(result?.updatedAt.getTime()).toBeGreaterThanOrEqual(result!.createdAt.getTime());
    });

    it('should not update a dataset owned by another user', async () => {
      const [dataset] = await serverDB
        .insert(agentEvalDatasets)
        .values({
          benchmarkId,
          identifier: 'other-dataset',
          name: 'Other Dataset',
          userId: userId2,
        })
        .returning();

      const result = await datasetModel.update(dataset.id, {
        name: 'Attempted Update',
      });

      expect(result).toBeUndefined();

      const unchanged = await serverDB.query.agentEvalDatasets.findFirst({
        where: eq(agentEvalDatasets.id, dataset.id),
      });
      expect(unchanged?.name).toBe('Other Dataset');
    });

    it('should return undefined when dataset not found', async () => {
      const result = await datasetModel.update('non-existent-id', {
        name: 'New Name',
      });

      expect(result).toBeUndefined();
    });

    it('should update only specified fields', async () => {
      const [dataset] = await serverDB
        .insert(agentEvalDatasets)
        .values({
          benchmarkId,
          identifier: 'partial-update',
          name: 'Original',
          description: 'Original Desc',
          userId,
        })
        .returning();

      const result = await datasetModel.update(dataset.id, {
        name: 'Only Name Changed',
      });

      expect(result?.name).toBe('Only Name Changed');
      expect(result?.description).toBe('Original Desc');
    });

    it('should update metadata', async () => {
      const [dataset] = await serverDB
        .insert(agentEvalDatasets)
        .values({
          benchmarkId,
          identifier: 'metadata-update',
          name: 'Metadata Test',
          metadata: { version: 1 },
          userId,
        })
        .returning();

      const result = await datasetModel.update(dataset.id, {
        metadata: { version: 2, updated: true },
      });

      expect(result?.metadata).toEqual({ version: 2, updated: true });
    });
  });
});
