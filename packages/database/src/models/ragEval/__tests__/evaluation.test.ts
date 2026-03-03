import { EvalEvaluationStatus } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  evalDatasets,
  evalEvaluation,
  evaluationRecords,
  knowledgeBases,
  users,
} from '../../../schemas';
import { EvalEvaluationModel } from '../evaluation';

const serverDB = await getTestDB();

const userId = 'eval-test-user';
const userId2 = 'eval-test-user-2';
const evalModel = new EvalEvaluationModel(serverDB, userId);

let datasetId: string;
let knowledgeBaseId: string;

beforeEach(async () => {
  await serverDB.delete(evaluationRecords);
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
});

afterEach(async () => {
  await serverDB.delete(evaluationRecords);
  await serverDB.delete(evalEvaluation);
  await serverDB.delete(evalDatasets);
  await serverDB.delete(knowledgeBases);
  await serverDB.delete(users);
});

describe('EvalEvaluationModel', () => {
  describe('create', () => {
    it('should create a new evaluation with userId', async () => {
      const result = await evalModel.create({
        datasetId,
        knowledgeBaseId,
        name: 'Test Evaluation',
      });

      expect(result).toBeDefined();
      expect(result.name).toBe('Test Evaluation');
      expect(result.datasetId).toBe(datasetId);
      expect(result.knowledgeBaseId).toBe(knowledgeBaseId);
      expect(result.userId).toBe(userId);
    });

    it('should create evaluation with description', async () => {
      const result = await evalModel.create({
        datasetId,
        knowledgeBaseId,
        name: 'Eval with desc',
        description: 'A test evaluation',
      });

      expect(result.description).toBe('A test evaluation');
    });
  });

  describe('delete', () => {
    it('should delete an evaluation owned by the user', async () => {
      const [evaluation] = await serverDB
        .insert(evalEvaluation)
        .values({ datasetId, knowledgeBaseId, name: 'Delete me', userId })
        .returning();

      await evalModel.delete(evaluation.id);

      const deleted = await serverDB.query.evalEvaluation.findFirst({
        where: eq(evalEvaluation.id, evaluation.id),
      });
      expect(deleted).toBeUndefined();
    });

    it('should not delete an evaluation owned by another user', async () => {
      const [evaluation] = await serverDB
        .insert(evalEvaluation)
        .values({ datasetId, knowledgeBaseId, name: 'Other eval', userId: userId2 })
        .returning();

      await evalModel.delete(evaluation.id);

      const stillExists = await serverDB.query.evalEvaluation.findFirst({
        where: eq(evalEvaluation.id, evaluation.id),
      });
      expect(stillExists).toBeDefined();
    });
  });

  describe('queryByKnowledgeBaseId', () => {
    it('should query evaluations with dataset info and record stats', async () => {
      const [evaluation] = await serverDB
        .insert(evalEvaluation)
        .values({ datasetId, knowledgeBaseId, name: 'Eval 1', userId })
        .returning();

      // Create a dataset record for the evaluation records to reference
      const { evalDatasetRecords } = await import('../../../schemas');
      const [datasetRecord] = await serverDB
        .insert(evalDatasetRecords)
        .values({ datasetId, question: 'test q', userId })
        .returning();

      await serverDB.insert(evaluationRecords).values([
        {
          evaluationId: evaluation.id,
          question: 'Q1',
          status: EvalEvaluationStatus.Success,
          datasetRecordId: datasetRecord.id,
          userId,
        },
        {
          evaluationId: evaluation.id,
          question: 'Q2',
          status: EvalEvaluationStatus.Success,
          datasetRecordId: datasetRecord.id,
          userId,
        },
      ]);

      const results = await evalModel.queryByKnowledgeBaseId(knowledgeBaseId);

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Eval 1');
      expect(results[0].dataset).toMatchObject({ id: datasetId, name: 'Test Dataset' });
      expect(results[0].recordsStats.total).toBe(2);
      expect(results[0].recordsStats.success).toBe(2);
    });

    it('should return empty stats when no records exist', async () => {
      await serverDB
        .insert(evalEvaluation)
        .values({ datasetId, knowledgeBaseId, name: 'Empty eval', userId })
        .returning();

      const results = await evalModel.queryByKnowledgeBaseId(knowledgeBaseId);

      expect(results).toHaveLength(1);
      expect(results[0].recordsStats).toEqual({ success: 0, total: 0 });
    });

    it('should only return evaluations for current user', async () => {
      await serverDB.insert(evalEvaluation).values([
        { datasetId, knowledgeBaseId, name: 'My eval', userId },
        { datasetId, knowledgeBaseId, name: 'Other eval', userId: userId2 },
      ]);

      const results = await evalModel.queryByKnowledgeBaseId(knowledgeBaseId);

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('My eval');
    });

    it('should return empty array for non-existent knowledge base', async () => {
      const results = await evalModel.queryByKnowledgeBaseId('non-existent');
      expect(results).toHaveLength(0);
    });
  });

  describe('findById', () => {
    it('should find an evaluation by id', async () => {
      const [evaluation] = await serverDB
        .insert(evalEvaluation)
        .values({ datasetId, knowledgeBaseId, name: 'Find me', userId })
        .returning();

      const result = await evalModel.findById(evaluation.id);

      expect(result).toBeDefined();
      expect(result?.name).toBe('Find me');
    });

    it('should not find evaluation owned by another user', async () => {
      const [evaluation] = await serverDB
        .insert(evalEvaluation)
        .values({ datasetId, knowledgeBaseId, name: 'Other', userId: userId2 })
        .returning();

      const result = await evalModel.findById(evaluation.id);
      expect(result).toBeUndefined();
    });

    it('should return undefined for non-existent id', async () => {
      const result = await evalModel.findById('non-existent');
      expect(result).toBeUndefined();
    });
  });

  describe('update', () => {
    it('should update an evaluation owned by the user', async () => {
      const [evaluation] = await serverDB
        .insert(evalEvaluation)
        .values({ datasetId, knowledgeBaseId, name: 'Original', userId })
        .returning();

      await evalModel.update(evaluation.id, {
        name: 'Updated',
        description: 'New description',
      });

      const updated = await serverDB.query.evalEvaluation.findFirst({
        where: eq(evalEvaluation.id, evaluation.id),
      });
      expect(updated?.name).toBe('Updated');
      expect(updated?.description).toBe('New description');
    });

    it('should not update an evaluation owned by another user', async () => {
      const [evaluation] = await serverDB
        .insert(evalEvaluation)
        .values({ datasetId, knowledgeBaseId, name: 'Other', userId: userId2 })
        .returning();

      await evalModel.update(evaluation.id, { name: 'Hacked' });

      const unchanged = await serverDB.query.evalEvaluation.findFirst({
        where: eq(evalEvaluation.id, evaluation.id),
      });
      expect(unchanged?.name).toBe('Other');
    });

    it('should update status field', async () => {
      const [evaluation] = await serverDB
        .insert(evalEvaluation)
        .values({ datasetId, knowledgeBaseId, name: 'Status test', userId })
        .returning();

      await evalModel.update(evaluation.id, { status: EvalEvaluationStatus.Success });

      const updated = await serverDB.query.evalEvaluation.findFirst({
        where: eq(evalEvaluation.id, evaluation.id),
      });
      expect(updated?.status).toBe(EvalEvaluationStatus.Success);
    });
  });
});
