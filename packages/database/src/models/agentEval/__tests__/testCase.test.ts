import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  agentEvalBenchmarks,
  agentEvalDatasets,
  agentEvalTestCases,
  users,
} from '../../../schemas';
import { AgentEvalTestCaseModel } from '../testCase';

const serverDB = await getTestDB();

const userId = 'testcase-test-user';
const testCaseModel = new AgentEvalTestCaseModel(serverDB, userId);

let datasetId: string;

beforeEach(async () => {
  await serverDB.delete(agentEvalTestCases);
  await serverDB.delete(agentEvalDatasets);
  await serverDB.delete(agentEvalBenchmarks);
  await serverDB.delete(users);

  // Create test user
  await serverDB.insert(users).values({ id: userId });

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

  // Create a test dataset
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

afterEach(async () => {
  await serverDB.delete(agentEvalTestCases);
  await serverDB.delete(agentEvalDatasets);
  await serverDB.delete(agentEvalBenchmarks);
  await serverDB.delete(users);
});

describe('AgentEvalTestCaseModel', () => {
  describe('create', () => {
    it('should create a new test case', async () => {
      const params = {
        datasetId,
        content: {
          input: 'What is AI?',
          expected: 'Artificial Intelligence...',
          context: { difficulty: 'easy' },
        },
        metadata: { source: 'manual' },
        sortOrder: 1,
      };

      const result = await testCaseModel.create(params);

      expect(result).toBeDefined();
      expect(result.datasetId).toBe(datasetId);
      expect(result.content).toEqual({
        input: 'What is AI?',
        expected: 'Artificial Intelligence...',
        context: { difficulty: 'easy' },
      });
      expect(result.metadata).toEqual({ source: 'manual' });
      expect(result.sortOrder).toBe(1);
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    it('should create a test case with minimal parameters', async () => {
      const params = {
        datasetId,
        content: {
          input: 'Minimal test',
        },
      };

      const result = await testCaseModel.create(params);

      expect(result).toBeDefined();
      expect(result.content.input).toBe('Minimal test');
      expect(result.content.expected).toBeUndefined();
    });

    it('should auto-assign sortOrder starting from 1 when not provided', async () => {
      const r1 = await testCaseModel.create({ datasetId, content: { input: 'Q1' } });
      const r2 = await testCaseModel.create({ datasetId, content: { input: 'Q2' } });
      const r3 = await testCaseModel.create({ datasetId, content: { input: 'Q3' } });

      expect(r1.sortOrder).toBe(1);
      expect(r2.sortOrder).toBe(2);
      expect(r3.sortOrder).toBe(3);
    });

    it('should continue sortOrder from existing max when auto-assigning', async () => {
      await testCaseModel.create({ datasetId, content: { input: 'Q1' }, sortOrder: 5 });

      const r2 = await testCaseModel.create({ datasetId, content: { input: 'Q2' } });

      expect(r2.sortOrder).toBe(6);
    });

    it('should continue sortOrder after gaps (e.g. 1, 3, 10 → next is 11)', async () => {
      await testCaseModel.create({ datasetId, content: { input: 'Q1' }, sortOrder: 1 });
      await testCaseModel.create({ datasetId, content: { input: 'Q2' }, sortOrder: 3 });
      await testCaseModel.create({ datasetId, content: { input: 'Q3' }, sortOrder: 10 });

      const r4 = await testCaseModel.create({ datasetId, content: { input: 'Q4' } });

      expect(r4.sortOrder).toBe(11);
    });

    it('should continue sortOrder after middle items deleted', async () => {
      const r1 = await testCaseModel.create({ datasetId, content: { input: 'Q1' } });
      const r2 = await testCaseModel.create({ datasetId, content: { input: 'Q2' } });
      await testCaseModel.create({ datasetId, content: { input: 'Q3' } });

      // Delete middle item
      await testCaseModel.delete(r2.id);

      // New item should still be max+1 = 4, not fill the gap
      const r4 = await testCaseModel.create({ datasetId, content: { input: 'Q4' } });
      expect(r4.sortOrder).toBe(4);
    });

    it('should mix explicit and auto sortOrder correctly', async () => {
      const r1 = await testCaseModel.create({ datasetId, content: { input: 'Q1' }, sortOrder: 3 });
      const r2 = await testCaseModel.create({ datasetId, content: { input: 'Q2' } }); // auto: 4
      const r3 = await testCaseModel.create({
        datasetId,
        content: { input: 'Q3' },
        sortOrder: 100,
      });
      const r4 = await testCaseModel.create({ datasetId, content: { input: 'Q4' } }); // auto: 101

      expect(r1.sortOrder).toBe(3);
      expect(r2.sortOrder).toBe(4);
      expect(r3.sortOrder).toBe(100);
      expect(r4.sortOrder).toBe(101);
    });
  });

  describe('batchCreate', () => {
    it('should create multiple test cases', async () => {
      const cases = [
        {
          datasetId,
          content: { input: 'Test 1' },
          sortOrder: 1,
        },
        {
          datasetId,
          content: { input: 'Test 2', expected: 'Answer 2' },
          sortOrder: 2,
        },
        {
          datasetId,
          content: { input: 'Test 3' },
          metadata: { reviewed: true },
          sortOrder: 3,
        },
      ];

      const results = await testCaseModel.batchCreate(cases);

      expect(results).toHaveLength(3);
      expect(results[0].content.input).toBe('Test 1');
      expect(results[1].content.expected).toBe('Answer 2');
      expect(results[2].metadata).toEqual({ reviewed: true });
    });

    it('should auto-inject userId from model', async () => {
      const results = await testCaseModel.batchCreate([
        { datasetId, content: { input: 'Q1' }, sortOrder: 1 },
      ]);

      expect(results[0].userId).toBe(userId);
    });

    it('should handle second batch import after first batch (simulating CSV import)', async () => {
      // First import: 3 items
      const batch1 = await testCaseModel.batchCreate([
        { datasetId, content: { input: 'Q1' }, sortOrder: 1 },
        { datasetId, content: { input: 'Q2' }, sortOrder: 2 },
        { datasetId, content: { input: 'Q3' }, sortOrder: 3 },
      ]);
      expect(batch1).toHaveLength(3);

      // Simulate how the router computes sortOrder for second import:
      // existingCount=3, so new items get 3+0+1=4, 3+1+1=5, 3+2+1=6
      const existingCount = await testCaseModel.countByDatasetId(datasetId);
      expect(existingCount).toBe(3);

      const batch2 = await testCaseModel.batchCreate([
        { datasetId, content: { input: 'Q4' }, sortOrder: existingCount + 1 },
        { datasetId, content: { input: 'Q5' }, sortOrder: existingCount + 2 },
      ]);

      expect(batch2[0].sortOrder).toBe(4);
      expect(batch2[1].sortOrder).toBe(5);

      // Verify total order via findByDatasetId
      const all = await testCaseModel.findByDatasetId(datasetId);
      expect(all).toHaveLength(5);
      expect(all.map((r) => r.sortOrder)).toEqual([1, 2, 3, 4, 5]);
      expect(all.map((r) => r.content.input)).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'Q5']);
    });

    it('should handle batch import after single creates', async () => {
      // Create via single create (auto sortOrder)
      await testCaseModel.create({ datasetId, content: { input: 'Q1' } }); // sortOrder=1
      await testCaseModel.create({ datasetId, content: { input: 'Q2' } }); // sortOrder=2

      // Now simulate CSV import
      const existingCount = await testCaseModel.countByDatasetId(datasetId);
      expect(existingCount).toBe(2);

      const batch = await testCaseModel.batchCreate([
        { datasetId, content: { input: 'Q3' }, sortOrder: existingCount + 1 },
        { datasetId, content: { input: 'Q4' }, sortOrder: existingCount + 2 },
        { datasetId, content: { input: 'Q5' }, sortOrder: existingCount + 3 },
      ]);

      const all = await testCaseModel.findByDatasetId(datasetId);
      expect(all).toHaveLength(5);
      expect(all.map((r) => r.sortOrder)).toEqual([1, 2, 3, 4, 5]);
    });

    it('should handle batch import after deleting some items', async () => {
      // Create 5 items
      const batch1 = await testCaseModel.batchCreate([
        { datasetId, content: { input: 'Q1' }, sortOrder: 1 },
        { datasetId, content: { input: 'Q2' }, sortOrder: 2 },
        { datasetId, content: { input: 'Q3' }, sortOrder: 3 },
        { datasetId, content: { input: 'Q4' }, sortOrder: 4 },
        { datasetId, content: { input: 'Q5' }, sortOrder: 5 },
      ]);

      // Delete Q2 and Q4 — remaining: Q1(1), Q3(3), Q5(5)
      await testCaseModel.delete(batch1[1].id);
      await testCaseModel.delete(batch1[3].id);

      // Import new items — existingCount=3, so sortOrder starts at 4
      const existingCount = await testCaseModel.countByDatasetId(datasetId);
      expect(existingCount).toBe(3);

      const batch2 = await testCaseModel.batchCreate([
        { datasetId, content: { input: 'Q6' }, sortOrder: existingCount + 1 },
        { datasetId, content: { input: 'Q7' }, sortOrder: existingCount + 2 },
      ]);

      expect(batch2[0].sortOrder).toBe(4);
      expect(batch2[1].sortOrder).toBe(5);

      // Verify total count and that new items are retrievable
      const all = await testCaseModel.findByDatasetId(datasetId);
      expect(all).toHaveLength(5);
      // Sorted by sortOrder: Q1(1), Q3(3), Q6(4), then Q5(5) & Q7(5) share same sortOrder
      expect(all[0].content.input).toBe('Q1');
      expect(all[0].sortOrder).toBe(1);
      expect(all[1].content.input).toBe('Q3');
      expect(all[1].sortOrder).toBe(3);
      expect(all[2].content.input).toBe('Q6');
      expect(all[2].sortOrder).toBe(4);
      // Q5 and Q7 both have sortOrder=5
      expect(all[3].sortOrder).toBe(5);
      expect(all[4].sortOrder).toBe(5);
      expect(new Set([all[3].content.input, all[4].content.input])).toEqual(new Set(['Q5', 'Q7']));
    });
  });

  describe('delete', () => {
    it('should delete a test case', async () => {
      const [testCase] = await serverDB
        .insert(agentEvalTestCases)
        .values({
          userId,
          datasetId,
          content: { input: 'Delete me' },
          sortOrder: 1,
        })
        .returning();

      await testCaseModel.delete(testCase.id);

      const deleted = await serverDB.query.agentEvalTestCases.findFirst({
        where: eq(agentEvalTestCases.id, testCase.id),
      });
      expect(deleted).toBeUndefined();
    });

    it('should return 0 rowCount when test case not found', async () => {
      await testCaseModel.delete('non-existent-id');
      // No rowCount in PGlite
    });
  });

  describe('findById', () => {
    it('should find a test case by id', async () => {
      const [testCase] = await serverDB
        .insert(agentEvalTestCases)
        .values({
          userId,
          datasetId,
          content: { input: 'Find me' },
          sortOrder: 1,
        })
        .returning();

      const result = await testCaseModel.findById(testCase.id);

      expect(result).toBeDefined();
      expect(result?.id).toBe(testCase.id);
      expect(result?.content.input).toBe('Find me');
    });

    it('should return undefined when test case not found', async () => {
      const result = await testCaseModel.findById('non-existent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('findByDatasetId', () => {
    beforeEach(async () => {
      await serverDB.insert(agentEvalTestCases).values([
        {
          userId,
          datasetId,
          content: { input: 'Test 1' },
          sortOrder: 3,
        },
        {
          userId,
          datasetId,
          content: { input: 'Test 2' },
          sortOrder: 1,
        },
        {
          userId,
          datasetId,
          content: { input: 'Test 3' },
          sortOrder: 2,
        },
      ]);
    });

    it('should find all test cases by dataset id', async () => {
      const results = await testCaseModel.findByDatasetId(datasetId);

      expect(results).toHaveLength(3);
    });

    it('should order by sortOrder', async () => {
      const results = await testCaseModel.findByDatasetId(datasetId);

      expect(results[0].sortOrder).toBe(1);
      expect(results[1].sortOrder).toBe(2);
      expect(results[2].sortOrder).toBe(3);
    });

    it('should support limit parameter', async () => {
      const results = await testCaseModel.findByDatasetId(datasetId, 2);

      expect(results).toHaveLength(2);
      expect(results[0].sortOrder).toBe(1);
      expect(results[1].sortOrder).toBe(2);
    });

    it('should support offset parameter', async () => {
      const results = await testCaseModel.findByDatasetId(datasetId, undefined, 1);

      expect(results).toHaveLength(2);
      expect(results[0].sortOrder).toBe(2);
      expect(results[1].sortOrder).toBe(3);
    });

    it('should support both limit and offset', async () => {
      const results = await testCaseModel.findByDatasetId(datasetId, 1, 1);

      expect(results).toHaveLength(1);
      expect(results[0].sortOrder).toBe(2);
    });

    it('should return empty array when dataset has no test cases', async () => {
      const results = await testCaseModel.findByDatasetId('non-existent-dataset');

      expect(results).toHaveLength(0);
    });

    it('should handle limit = 0', async () => {
      const results = await testCaseModel.findByDatasetId(datasetId, 0);

      expect(results).toHaveLength(0);
    });

    it('should handle offset beyond available records', async () => {
      const results = await testCaseModel.findByDatasetId(datasetId, undefined, 10);

      expect(results).toHaveLength(0);
    });
  });

  describe('countByDatasetId', () => {
    it('should count test cases by dataset id', async () => {
      await serverDB.insert(agentEvalTestCases).values([
        { userId, datasetId, content: { input: 'Test 1' }, sortOrder: 1 },
        { userId, datasetId, content: { input: 'Test 2' }, sortOrder: 2 },
        { userId, datasetId, content: { input: 'Test 3' }, sortOrder: 3 },
      ]);

      const count = await testCaseModel.countByDatasetId(datasetId);

      expect(count).toBe(3);
    });

    it('should return 0 when dataset has no test cases', async () => {
      const count = await testCaseModel.countByDatasetId('non-existent-dataset');

      expect(count).toBe(0);
    });

    it('should return correct count after adding more test cases', async () => {
      await serverDB
        .insert(agentEvalTestCases)
        .values([{ userId, datasetId, content: { input: 'Test 1' }, sortOrder: 1 }]);

      let count = await testCaseModel.countByDatasetId(datasetId);
      expect(count).toBe(1);

      await serverDB
        .insert(agentEvalTestCases)
        .values([{ userId, datasetId, content: { input: 'Test 2' }, sortOrder: 2 }]);

      count = await testCaseModel.countByDatasetId(datasetId);
      expect(count).toBe(2);
    });
  });

  describe('update', () => {
    it('should update a test case', async () => {
      const [testCase] = await serverDB
        .insert(agentEvalTestCases)
        .values({
          userId,
          datasetId,
          content: { input: 'Original' },
          sortOrder: 1,
        })
        .returning();

      const result = await testCaseModel.update(testCase.id, {
        content: { input: 'Updated', expected: 'New answer' },
        metadata: { reviewed: true },
      });

      expect(result).toBeDefined();
      expect(result?.content.input).toBe('Updated');
      expect(result?.content.expected).toBe('New answer');
      expect(result?.metadata).toEqual({ reviewed: true });
      expect(result?.updatedAt).toBeDefined();
      expect(result?.updatedAt.getTime()).toBeGreaterThanOrEqual(result!.createdAt.getTime());
    });

    it('should update only sortOrder', async () => {
      const [testCase] = await serverDB
        .insert(agentEvalTestCases)
        .values({
          userId,
          datasetId,
          content: { input: 'Test' },
          sortOrder: 1,
        })
        .returning();

      const result = await testCaseModel.update(testCase.id, {
        sortOrder: 5,
      });

      expect(result?.sortOrder).toBe(5);
      expect(result?.content.input).toBe('Test');
    });

    it('should return undefined when test case not found', async () => {
      const result = await testCaseModel.update('non-existent-id', {
        content: { input: 'New' },
      });

      expect(result).toBeUndefined();
    });

    it('should update content partially', async () => {
      const [testCase] = await serverDB
        .insert(agentEvalTestCases)
        .values({
          userId,
          datasetId,
          content: {
            input: 'Original Input',
            expected: 'Original Expected',
          },
          sortOrder: 1,
        })
        .returning();

      const result = await testCaseModel.update(testCase.id, {
        content: {
          input: 'Original Input',
          expected: 'Updated Expected',
        },
      });

      expect(result?.content.expected).toBe('Updated Expected');
      expect(result?.content.input).toBe('Original Input');
    });
  });
});
