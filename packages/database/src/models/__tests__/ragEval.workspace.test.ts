// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  evalDatasetRecords,
  evalDatasets,
  evalEvaluation,
  evaluationRecords,
  knowledgeBases,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import {
  EvalDatasetModel,
  EvalDatasetRecordModel,
  EvalEvaluationModel,
  EvaluationRecordModel,
} from '../ragEval';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'rag-eval-workspace-user';
const workspaceId = 'rag-eval-workspace';
const personalKnowledgeBaseId = 'rag-eval-personal-kb';
const workspaceKnowledgeBaseId = 'rag-eval-workspace-kb';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(workspaces).values({
    id: workspaceId,
    name: 'RAG Eval Workspace',
    primaryOwnerId: userId,
    slug: workspaceId,
  });
  await serverDB.insert(knowledgeBases).values([
    {
      id: personalKnowledgeBaseId,
      name: 'Personal KB',
      userId,
      workspaceId: null,
    },
    {
      id: workspaceKnowledgeBaseId,
      name: 'Workspace KB',
      userId,
      workspaceId,
    },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('RAG eval workspace scope', () => {
  it('isolates datasets and dataset records between personal and workspace scopes', async () => {
    const personalDatasetModel = new EvalDatasetModel(serverDB, userId);
    const workspaceDatasetModel = new EvalDatasetModel(serverDB, userId, workspaceId);

    const personalDataset = await personalDatasetModel.create({
      knowledgeBaseId: personalKnowledgeBaseId,
      name: 'Personal dataset',
    });
    const workspaceDataset = await workspaceDatasetModel.create({
      knowledgeBaseId: workspaceKnowledgeBaseId,
      name: 'Workspace dataset',
    });

    await expect(personalDatasetModel.query(personalKnowledgeBaseId)).resolves.toEqual([
      expect.objectContaining({ id: personalDataset.id }),
    ]);
    await expect(workspaceDatasetModel.query(workspaceKnowledgeBaseId)).resolves.toEqual([
      expect.objectContaining({ id: workspaceDataset.id }),
    ]);
    await expect(personalDatasetModel.findById(personalDataset.id)).resolves.toMatchObject({
      id: personalDataset.id,
      workspaceId: null,
    });
    await expect(workspaceDatasetModel.findById(workspaceDataset.id)).resolves.toMatchObject({
      id: workspaceDataset.id,
      workspaceId,
    });

    const personalRecordModel = new EvalDatasetRecordModel(serverDB, userId);
    const workspaceRecordModel = new EvalDatasetRecordModel(serverDB, userId, workspaceId);

    const personalRecord = await personalRecordModel.create({
      datasetId: personalDataset.id,
      question: 'Personal question',
    });
    const workspaceRecord = await workspaceRecordModel.create({
      datasetId: workspaceDataset.id,
      question: 'Workspace question',
    });

    await expect(personalRecordModel.findById(workspaceRecord.id)).resolves.toBeUndefined();
    await expect(workspaceRecordModel.findById(personalRecord.id)).resolves.toBeUndefined();

    await personalRecordModel.update(personalRecord.id, { question: 'Updated personal question' });
    await expect(personalRecordModel.findById(personalRecord.id)).resolves.toMatchObject({
      question: 'Updated personal question',
      workspaceId: null,
    });

    await personalDatasetModel.delete(personalDataset.id);

    await expect(personalDatasetModel.findById(personalDataset.id)).resolves.toBeUndefined();
    await expect(workspaceDatasetModel.findById(workspaceDataset.id)).resolves.toMatchObject({
      id: workspaceDataset.id,
      workspaceId,
    });
  });

  it('isolates evaluations and evaluation records between personal and workspace scopes', async () => {
    const personalDatasetModel = new EvalDatasetModel(serverDB, userId);
    const workspaceDatasetModel = new EvalDatasetModel(serverDB, userId, workspaceId);
    const personalRecordModel = new EvalDatasetRecordModel(serverDB, userId);
    const workspaceRecordModel = new EvalDatasetRecordModel(serverDB, userId, workspaceId);
    const personalEvaluationModel = new EvalEvaluationModel(serverDB, userId);
    const workspaceEvaluationModel = new EvalEvaluationModel(serverDB, userId, workspaceId);
    const personalEvaluationRecordModel = new EvaluationRecordModel(serverDB, userId);
    const workspaceEvaluationRecordModel = new EvaluationRecordModel(serverDB, userId, workspaceId);

    const personalDataset = await personalDatasetModel.create({
      knowledgeBaseId: personalKnowledgeBaseId,
      name: 'Personal dataset',
    });
    const workspaceDataset = await workspaceDatasetModel.create({
      knowledgeBaseId: workspaceKnowledgeBaseId,
      name: 'Workspace dataset',
    });
    const personalDatasetRecord = await personalRecordModel.create({
      datasetId: personalDataset.id,
      question: 'Personal question',
    });
    const workspaceDatasetRecord = await workspaceRecordModel.create({
      datasetId: workspaceDataset.id,
      question: 'Workspace question',
    });

    const personalEvaluation = await personalEvaluationModel.create({
      datasetId: personalDataset.id,
      knowledgeBaseId: personalKnowledgeBaseId,
      name: 'Personal evaluation',
    });
    const workspaceEvaluation = await workspaceEvaluationModel.create({
      datasetId: workspaceDataset.id,
      knowledgeBaseId: workspaceKnowledgeBaseId,
      name: 'Workspace evaluation',
    });

    await expect(
      personalEvaluationModel.queryByKnowledgeBaseId(personalKnowledgeBaseId),
    ).resolves.toEqual([expect.objectContaining({ id: personalEvaluation.id })]);
    await expect(
      workspaceEvaluationModel.queryByKnowledgeBaseId(workspaceKnowledgeBaseId),
    ).resolves.toEqual([expect.objectContaining({ id: workspaceEvaluation.id })]);
    await expect(personalEvaluationModel.findById(personalEvaluation.id)).resolves.toMatchObject({
      id: personalEvaluation.id,
      workspaceId: null,
    });
    await expect(workspaceEvaluationModel.findById(workspaceEvaluation.id)).resolves.toMatchObject({
      id: workspaceEvaluation.id,
      workspaceId,
    });

    const personalEvaluationRecord = await personalEvaluationRecordModel.create({
      datasetRecordId: personalDatasetRecord.id,
      evaluationId: personalEvaluation.id,
      question: 'Personal eval question',
    });
    const workspaceEvaluationRecord = await workspaceEvaluationRecordModel.create({
      datasetRecordId: workspaceDatasetRecord.id,
      evaluationId: workspaceEvaluation.id,
      question: 'Workspace eval question',
    });

    await expect(
      personalEvaluationRecordModel.findById(workspaceEvaluationRecord.id),
    ).resolves.toBeUndefined();
    await expect(
      workspaceEvaluationRecordModel.findById(personalEvaluationRecord.id),
    ).resolves.toBeUndefined();

    await personalEvaluationRecordModel.delete(personalEvaluationRecord.id);

    await expect(personalEvaluationRecordModel.query(personalEvaluation.id)).resolves.toEqual([]);
    await expect(workspaceEvaluationRecordModel.query(workspaceEvaluation.id)).resolves.toEqual([
      expect.objectContaining({ id: workspaceEvaluationRecord.id, workspaceId }),
    ]);
  });
});

afterEach(async () => {
  await serverDB.delete(evaluationRecords).where(eq(evaluationRecords.userId, userId));
  await serverDB.delete(evalEvaluation).where(eq(evalEvaluation.userId, userId));
  await serverDB.delete(evalDatasetRecords).where(eq(evalDatasetRecords.userId, userId));
  await serverDB.delete(evalDatasets).where(eq(evalDatasets.userId, userId));
  await serverDB.delete(knowledgeBases).where(eq(knowledgeBases.userId, userId));
});
