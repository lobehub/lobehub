import { EvalEvaluationStatus } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  evalDatasetRecords,
  evalDatasets,
  evalEvaluation,
  evaluationRecords,
  knowledgeBases,
  users,
} from '../../../schemas';
import { EvaluationRecordModel } from '../evaluationRecord';

const serverDB = await getTestDB();

const userId = 'eval-record-test-user';
const userId2 = 'eval-record-test-user-2';
const recordModel = new EvaluationRecordModel(serverDB, userId);

let datasetId: string;
let evaluationId: string;
let datasetRecordId: string;
let knowledgeBaseId: string;

beforeEach(async () => {
  await serverDB.delete(evaluationRecords);
  await serverDB.delete(evalDatasetRecords);
  await serverDB.delete(evalEvaluation);
  await serverDB.delete(evalDatasets);
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

  const [evaluation] = await serverDB
    .insert(evalEvaluation)
    .values({ datasetId, knowledgeBaseId, name: 'Test Evaluation', userId })
    .returning();
  evaluationId = evaluation.id;

  const [dsRecord] = await serverDB
    .insert(evalDatasetRecords)
    .values({ datasetId, question: 'Test Q', userId })
    .returning();
  datasetRecordId = dsRecord.id;
});

afterEach(async () => {
  await serverDB.delete(evaluationRecords);
  await serverDB.delete(evalDatasetRecords);
  await serverDB.delete(evalEvaluation);
  await serverDB.delete(evalDatasets);
  await serverDB.delete(knowledgeBases);
  await serverDB.delete(users);
});

describe('EvaluationRecordModel', () => {
  describe('create', () => {
    it('should create a new evaluation record with userId', async () => {
      const result = await recordModel.create({
        evaluationId,
        datasetRecordId,
        question: 'What is AI?',
        answer: 'Artificial Intelligence',
      });

      expect(result).toBeDefined();
      expect(result.evaluationId).toBe(evaluationId);
      expect(result.datasetRecordId).toBe(datasetRecordId);
      expect(result.question).toBe('What is AI?');
      expect(result.answer).toBe('Artificial Intelligence');
      expect(result.userId).toBe(userId);
    });

    it('should create a record with status and context', async () => {
      const result = await recordModel.create({
        evaluationId,
        datasetRecordId,
        question: 'Test',
        status: EvalEvaluationStatus.Success,
        context: ['ctx1', 'ctx2'],
      });

      expect(result.status).toBe(EvalEvaluationStatus.Success);
      expect(result.context).toEqual(['ctx1', 'ctx2']);
    });
  });

  describe('batchCreate', () => {
    it('should batch create evaluation records', async () => {
      const results = await recordModel.batchCreate([
        { evaluationId, datasetRecordId, question: 'Q1' },
        { evaluationId, datasetRecordId, question: 'Q2' },
      ]);

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.userId === userId)).toBe(true);
    });
  });

  describe('delete', () => {
    it('should delete a record owned by the user', async () => {
      const [record] = await serverDB
        .insert(evaluationRecords)
        .values({
          evaluationId,
          datasetRecordId,
          question: 'Delete me',
          userId,
        })
        .returning();

      await recordModel.delete(record.id);

      const deleted = await serverDB.query.evaluationRecords.findFirst({
        where: eq(evaluationRecords.id, record.id),
      });
      expect(deleted).toBeUndefined();
    });

    it('should not delete a record owned by another user', async () => {
      const [record] = await serverDB
        .insert(evaluationRecords)
        .values({
          evaluationId,
          datasetRecordId,
          question: 'Other user record',
          userId: userId2,
        })
        .returning();

      await recordModel.delete(record.id);

      const stillExists = await serverDB.query.evaluationRecords.findFirst({
        where: eq(evaluationRecords.id, record.id),
      });
      expect(stillExists).toBeDefined();
    });
  });

  describe('query', () => {
    it('should query records by evaluationId (reportId)', async () => {
      await serverDB.insert(evaluationRecords).values([
        { evaluationId, datasetRecordId, question: 'Q1', userId },
        { evaluationId, datasetRecordId, question: 'Q2', userId },
      ]);

      const results = await recordModel.query(evaluationId);

      expect(results).toHaveLength(2);
    });

    it('should only return records for current user', async () => {
      await serverDB.insert(evaluationRecords).values([
        { evaluationId, datasetRecordId, question: 'My Q', userId },
        { evaluationId, datasetRecordId, question: 'Other Q', userId: userId2 },
      ]);

      const results = await recordModel.query(evaluationId);

      expect(results).toHaveLength(1);
      expect(results[0].question).toBe('My Q');
    });

    it('should return empty array for non-existent evaluationId', async () => {
      const results = await recordModel.query('non-existent');
      expect(results).toHaveLength(0);
    });
  });

  describe('findById', () => {
    it('should find a record by id', async () => {
      const [record] = await serverDB
        .insert(evaluationRecords)
        .values({ evaluationId, datasetRecordId, question: 'Find me', userId })
        .returning();

      const result = await recordModel.findById(record.id);

      expect(result).toBeDefined();
      expect(result?.question).toBe('Find me');
    });

    it('should not find a record owned by another user', async () => {
      const [record] = await serverDB
        .insert(evaluationRecords)
        .values({ evaluationId, datasetRecordId, question: 'Other', userId: userId2 })
        .returning();

      const result = await recordModel.findById(record.id);
      expect(result).toBeUndefined();
    });

    it('should return undefined for non-existent id', async () => {
      const result = await recordModel.findById('non-existent');
      expect(result).toBeUndefined();
    });
  });

  describe('findByEvaluationId', () => {
    it('should find all records by evaluationId', async () => {
      await serverDB.insert(evaluationRecords).values([
        { evaluationId, datasetRecordId, question: 'Q1', userId },
        { evaluationId, datasetRecordId, question: 'Q2', userId },
      ]);

      const results = await recordModel.findByEvaluationId(evaluationId);

      expect(results).toHaveLength(2);
    });

    it('should only return records for current user', async () => {
      await serverDB.insert(evaluationRecords).values([
        { evaluationId, datasetRecordId, question: 'My Q', userId },
        { evaluationId, datasetRecordId, question: 'Other Q', userId: userId2 },
      ]);

      const results = await recordModel.findByEvaluationId(evaluationId);

      expect(results).toHaveLength(1);
    });

    it('should return empty array when no records found', async () => {
      const results = await recordModel.findByEvaluationId('non-existent');
      expect(results).toHaveLength(0);
    });
  });

  describe('update', () => {
    it('should update a record owned by the user', async () => {
      const [record] = await serverDB
        .insert(evaluationRecords)
        .values({ evaluationId, datasetRecordId, question: 'Original', userId })
        .returning();

      await recordModel.update(record.id, {
        answer: 'New answer',
        status: EvalEvaluationStatus.Success,
      });

      const updated = await serverDB.query.evaluationRecords.findFirst({
        where: eq(evaluationRecords.id, record.id),
      });
      expect(updated?.answer).toBe('New answer');
      expect(updated?.status).toBe(EvalEvaluationStatus.Success);
    });

    it('should not update a record owned by another user', async () => {
      const [record] = await serverDB
        .insert(evaluationRecords)
        .values({ evaluationId, datasetRecordId, question: 'Other', userId: userId2 })
        .returning();

      await recordModel.update(record.id, { answer: 'Hacked' });

      const unchanged = await serverDB.query.evaluationRecords.findFirst({
        where: eq(evaluationRecords.id, record.id),
      });
      expect(unchanged?.answer).toBeNull();
    });
  });
});
