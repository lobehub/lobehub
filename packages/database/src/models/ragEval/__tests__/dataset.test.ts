import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { evalDatasets, knowledgeBases, users } from '../../../schemas';
import { EvalDatasetModel } from '../dataset';

const serverDB = await getTestDB();

const userId = 'dataset-test-user';
const userId2 = 'dataset-test-user-2';
const datasetModel = new EvalDatasetModel(serverDB, userId);

let knowledgeBaseId: string;

beforeEach(async () => {
  await serverDB.delete(evalDatasets);
  await serverDB.delete(knowledgeBases);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: userId }, { id: userId2 }]);

  const [kb] = await serverDB
    .insert(knowledgeBases)
    .values({ name: 'Test KB', userId })
    .returning();
  knowledgeBaseId = kb.id;
});

afterEach(async () => {
  await serverDB.delete(evalDatasets);
  await serverDB.delete(knowledgeBases);
  await serverDB.delete(users);
});

describe('EvalDatasetModel', () => {
  describe('create', () => {
    it('should create a new dataset with userId', async () => {
      const result = await datasetModel.create({
        knowledgeBaseId,
        name: 'Test Dataset',
      });

      expect(result).toBeDefined();
      expect(result.name).toBe('Test Dataset');
      expect(result.knowledgeBaseId).toBe(knowledgeBaseId);
      expect(result.userId).toBe(userId);
    });

    it('should create dataset with description', async () => {
      const result = await datasetModel.create({
        knowledgeBaseId,
        name: 'Dataset with desc',
        description: 'A test dataset description',
      });

      expect(result.description).toBe('A test dataset description');
    });
  });

  describe('delete', () => {
    it('should delete a dataset owned by the user', async () => {
      const [dataset] = await serverDB
        .insert(evalDatasets)
        .values({ knowledgeBaseId, name: 'Delete me', userId })
        .returning();

      await datasetModel.delete(dataset.id);

      const deleted = await serverDB.query.evalDatasets.findFirst({
        where: eq(evalDatasets.id, dataset.id),
      });
      expect(deleted).toBeUndefined();
    });

    it('should not delete a dataset owned by another user', async () => {
      const [dataset] = await serverDB
        .insert(evalDatasets)
        .values({ knowledgeBaseId, name: 'Other dataset', userId: userId2 })
        .returning();

      await datasetModel.delete(dataset.id);

      const stillExists = await serverDB.query.evalDatasets.findFirst({
        where: eq(evalDatasets.id, dataset.id),
      });
      expect(stillExists).toBeDefined();
    });
  });

  describe('query', () => {
    it('should query datasets by knowledgeBaseId for current user', async () => {
      await serverDB.insert(evalDatasets).values([
        { knowledgeBaseId, name: 'Dataset 1', userId },
        { knowledgeBaseId, name: 'Dataset 2', userId },
      ]);

      const results = await datasetModel.query(knowledgeBaseId);

      expect(results).toHaveLength(2);
      expect(results[0]).toHaveProperty('id');
      expect(results[0]).toHaveProperty('name');
      expect(results[0]).toHaveProperty('description');
      expect(results[0]).toHaveProperty('createdAt');
      expect(results[0]).toHaveProperty('updatedAt');
    });

    it('should not return datasets from other users', async () => {
      await serverDB.insert(evalDatasets).values([
        { knowledgeBaseId, name: 'My dataset', userId },
        { knowledgeBaseId, name: 'Other dataset', userId: userId2 },
      ]);

      const results = await datasetModel.query(knowledgeBaseId);

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('My dataset');
    });

    it('should return empty array for non-existent knowledge base', async () => {
      const results = await datasetModel.query('non-existent');
      expect(results).toHaveLength(0);
    });

    it('should order results by createdAt desc', async () => {
      const [d1] = await serverDB
        .insert(evalDatasets)
        .values({ knowledgeBaseId, name: 'First', userId })
        .returning();

      const [d2] = await serverDB
        .insert(evalDatasets)
        .values({ knowledgeBaseId, name: 'Second', userId })
        .returning();

      const results = await datasetModel.query(knowledgeBaseId);

      // Second should come first (desc order)
      expect(results).toHaveLength(2);
    });
  });

  describe('findById', () => {
    it('should find a dataset by id', async () => {
      const [dataset] = await serverDB
        .insert(evalDatasets)
        .values({ knowledgeBaseId, name: 'Find me', userId })
        .returning();

      const result = await datasetModel.findById(dataset.id);

      expect(result).toBeDefined();
      expect(result?.name).toBe('Find me');
    });

    it('should not find dataset owned by another user', async () => {
      const [dataset] = await serverDB
        .insert(evalDatasets)
        .values({ knowledgeBaseId, name: 'Other', userId: userId2 })
        .returning();

      const result = await datasetModel.findById(dataset.id);
      expect(result).toBeUndefined();
    });

    it('should return undefined for non-existent id', async () => {
      const result = await datasetModel.findById('non-existent');
      expect(result).toBeUndefined();
    });
  });

  describe('update', () => {
    it('should update a dataset owned by the user', async () => {
      const [dataset] = await serverDB
        .insert(evalDatasets)
        .values({ knowledgeBaseId, name: 'Original', userId })
        .returning();

      await datasetModel.update(dataset.id, {
        name: 'Updated',
        description: 'New description',
      });

      const updated = await serverDB.query.evalDatasets.findFirst({
        where: eq(evalDatasets.id, dataset.id),
      });
      expect(updated?.name).toBe('Updated');
      expect(updated?.description).toBe('New description');
    });

    it('should not update a dataset owned by another user', async () => {
      const [dataset] = await serverDB
        .insert(evalDatasets)
        .values({ knowledgeBaseId, name: 'Other', userId: userId2 })
        .returning();

      await datasetModel.update(dataset.id, { name: 'Hacked' });

      const unchanged = await serverDB.query.evalDatasets.findFirst({
        where: eq(evalDatasets.id, dataset.id),
      });
      expect(unchanged?.name).toBe('Other');
    });

    it('should update the updatedAt timestamp', async () => {
      const [dataset] = await serverDB
        .insert(evalDatasets)
        .values({ knowledgeBaseId, name: 'Timestamp test', userId })
        .returning();

      const originalUpdatedAt = dataset.updatedAt;

      // Small delay to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      await datasetModel.update(dataset.id, { name: 'Updated' });

      const updated = await serverDB.query.evalDatasets.findFirst({
        where: eq(evalDatasets.id, dataset.id),
      });
      expect(updated?.updatedAt).not.toEqual(originalUpdatedAt);
    });
  });
});
