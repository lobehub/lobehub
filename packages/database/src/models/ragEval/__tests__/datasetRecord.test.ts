import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { evalDatasetRecords, evalDatasets, files, knowledgeBases, users } from '../../../schemas';
import { EvalDatasetRecordModel } from '../datasetRecord';

const serverDB = await getTestDB();

const userId = 'dataset-record-test-user';
const userId2 = 'dataset-record-test-user-2';
const recordModel = new EvalDatasetRecordModel(serverDB, userId);

let datasetId: string;
let knowledgeBaseId: string;

beforeEach(async () => {
  await serverDB.delete(evalDatasetRecords);
  await serverDB.delete(evalDatasets);
  await serverDB.delete(files);
  await serverDB.delete(knowledgeBases);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: userId }, { id: userId2 }]);

  const [kb] = await serverDB
    .insert(knowledgeBases)
    .values({ name: 'Test KB', userId })
    .returning();
  knowledgeBaseId = kb.id;

  const [dataset] = await serverDB
    .insert(evalDatasets)
    .values({ knowledgeBaseId, name: 'Test Dataset', userId })
    .returning();
  datasetId = dataset.id;
});

afterEach(async () => {
  await serverDB.delete(evalDatasetRecords);
  await serverDB.delete(evalDatasets);
  await serverDB.delete(files);
  await serverDB.delete(knowledgeBases);
  await serverDB.delete(users);
});

describe('EvalDatasetRecordModel', () => {
  describe('create', () => {
    it('should create a new record with userId', async () => {
      const result = await recordModel.create({
        datasetId,
        question: 'What is AI?',
        ideal: 'Artificial Intelligence',
      });

      expect(result).toBeDefined();
      expect(result.datasetId).toBe(datasetId);
      expect(result.question).toBe('What is AI?');
      expect(result.ideal).toBe('Artificial Intelligence');
      expect(result.userId).toBe(userId);
    });

    it('should create a record with referenceFiles', async () => {
      const result = await recordModel.create({
        datasetId,
        question: 'Test question',
        referenceFiles: ['file-1', 'file-2'],
      });

      expect(result.referenceFiles).toEqual(['file-1', 'file-2']);
    });
  });

  describe('batchCreate', () => {
    it('should batch create records', async () => {
      const result = await recordModel.batchCreate([
        { datasetId, question: 'Q1', ideal: 'A1' },
        { datasetId, question: 'Q2', ideal: 'A2' },
      ]);

      expect(result).toBeDefined();
      expect(result.userId).toBe(userId);

      const allRecords = await serverDB.query.evalDatasetRecords.findMany({
        where: eq(evalDatasetRecords.datasetId, datasetId),
      });
      expect(allRecords).toHaveLength(2);
    });
  });

  describe('delete', () => {
    it('should delete a record owned by the user', async () => {
      const [record] = await serverDB
        .insert(evalDatasetRecords)
        .values({ datasetId, question: 'Delete me', userId })
        .returning();

      await recordModel.delete(record.id);

      const deleted = await serverDB.query.evalDatasetRecords.findFirst({
        where: eq(evalDatasetRecords.id, record.id),
      });
      expect(deleted).toBeUndefined();
    });

    it('should not delete a record owned by another user', async () => {
      const [record] = await serverDB
        .insert(evalDatasetRecords)
        .values({ datasetId, question: 'Other user record', userId: userId2 })
        .returning();

      await recordModel.delete(record.id);

      const stillExists = await serverDB.query.evalDatasetRecords.findFirst({
        where: eq(evalDatasetRecords.id, record.id),
      });
      expect(stillExists).toBeDefined();
    });
  });

  describe('query', () => {
    it('should query records by datasetId with resolved reference files', async () => {
      const [file1] = await serverDB
        .insert(files)
        .values({
          fileType: 'application/pdf',
          name: 'doc.pdf',
          size: 1024,
          url: 'https://example.com/doc.pdf',
          userId,
        })
        .returning();

      await serverDB.insert(evalDatasetRecords).values({
        datasetId,
        question: 'Q1',
        referenceFiles: [file1.id],
        userId,
      });

      const results = await recordModel.query(datasetId);

      expect(results).toHaveLength(1);
      expect(results[0].referenceFiles).toHaveLength(1);
      expect(results[0].referenceFiles[0]).toMatchObject({
        id: file1.id,
        name: 'doc.pdf',
        fileType: 'application/pdf',
      });
    });

    it('should return records without reference files', async () => {
      await serverDB.insert(evalDatasetRecords).values({
        datasetId,
        question: 'Q1',
        userId,
      });

      const results = await recordModel.query(datasetId);

      expect(results).toHaveLength(1);
      expect(results[0].referenceFiles).toEqual([]);
    });

    it('should only return records for current user', async () => {
      await serverDB.insert(evalDatasetRecords).values([
        { datasetId, question: 'User Q', userId },
        { datasetId, question: 'Other Q', userId: userId2 },
      ]);

      const results = await recordModel.query(datasetId);

      expect(results).toHaveLength(1);
      expect(results[0].question).toBe('User Q');
    });
  });

  describe('findByDatasetId', () => {
    it('should find all records by datasetId for current user', async () => {
      await serverDB.insert(evalDatasetRecords).values([
        { datasetId, question: 'Q1', userId },
        { datasetId, question: 'Q2', userId },
        { datasetId, question: 'Q3', userId: userId2 },
      ]);

      const results = await recordModel.findByDatasetId(datasetId);

      expect(results).toHaveLength(2);
    });

    it('should return empty array when no records found', async () => {
      const results = await recordModel.findByDatasetId('non-existent');
      expect(results).toHaveLength(0);
    });
  });

  describe('findById', () => {
    it('should find a record by id', async () => {
      const [record] = await serverDB
        .insert(evalDatasetRecords)
        .values({ datasetId, question: 'Find me', userId })
        .returning();

      const result = await recordModel.findById(record.id);

      expect(result).toBeDefined();
      expect(result?.question).toBe('Find me');
    });

    it('should not find a record owned by another user', async () => {
      const [record] = await serverDB
        .insert(evalDatasetRecords)
        .values({ datasetId, question: 'Other', userId: userId2 })
        .returning();

      const result = await recordModel.findById(record.id);
      expect(result).toBeUndefined();
    });

    it('should return undefined for non-existent id', async () => {
      const result = await recordModel.findById('non-existent');
      expect(result).toBeUndefined();
    });
  });

  describe('update', () => {
    it('should update a record owned by the user', async () => {
      const [record] = await serverDB
        .insert(evalDatasetRecords)
        .values({ datasetId, question: 'Original', ideal: 'Original', userId })
        .returning();

      await recordModel.update(record.id, {
        question: 'Updated',
        ideal: 'Updated ideal',
      });

      const updated = await serverDB.query.evalDatasetRecords.findFirst({
        where: eq(evalDatasetRecords.id, record.id),
      });
      expect(updated?.question).toBe('Updated');
      expect(updated?.ideal).toBe('Updated ideal');
    });

    it('should not update a record owned by another user', async () => {
      const [record] = await serverDB
        .insert(evalDatasetRecords)
        .values({ datasetId, question: 'Other', userId: userId2 })
        .returning();

      await recordModel.update(record.id, { question: 'Hacked' });

      const unchanged = await serverDB.query.evalDatasetRecords.findFirst({
        where: eq(evalDatasetRecords.id, record.id),
      });
      expect(unchanged?.question).toBe('Other');
    });
  });
});
