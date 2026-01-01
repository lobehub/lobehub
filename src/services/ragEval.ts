import {
  type CreateNewEvalDatasets,
  type CreateNewEvalEvaluation,
  type EvalDatasetRecord,
  type RAGEvalDataSetItem,
  type RAGEvalEvaluationItem,
  type insertEvalDatasetsSchema,
} from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';
import { uploadService } from '@/services/upload';

class RAGEvalService {
  // Dataset
  createDataset = async (params: CreateNewEvalDatasets): Promise<number | undefined> => {
    return lambdaClient.ragEval.createDataset.mutate(params);
  };

  getDatasets = async (knowledgeBaseId: string): Promise<RAGEvalDataSetItem[]> => {
    return lambdaClient.ragEval.getDatasets.query({ knowledgeBaseId });
  };

  removeDataset = async (id: number): Promise<void> => {
    await lambdaClient.ragEval.removeDataset.mutate({ id });
  };

  updateDataset = async (
    id: number,
    value: Partial<typeof insertEvalDatasetsSchema>,
  ): Promise<void> => {
    await lambdaClient.ragEval.updateDataset.mutate({ id, value });
  };

  // Dataset Records
  getDatasetRecords = async (datasetId: number): Promise<EvalDatasetRecord[]> => {
    return lambdaClient.ragEval.getDatasetRecords.query({ datasetId });
  };

  removeDatasetRecord = async (id: number): Promise<void> => {
    await lambdaClient.ragEval.removeDatasetRecords.mutate({ id });
  };

  importDatasetRecords = async (datasetId: number, file: File): Promise<void> => {
    const { path } = await uploadService.uploadToServerS3(file, { directory: 'ragEval' });

    await lambdaClient.ragEval.importDatasetRecords.mutate({ datasetId, pathname: path });
  };

  // Evaluation
  createEvaluation = async (params: CreateNewEvalEvaluation): Promise<number | undefined> => {
    return lambdaClient.ragEval.createEvaluation.mutate(params);
  };

  getEvaluationList = async (knowledgeBaseId: string): Promise<RAGEvalEvaluationItem[]> => {
    return lambdaClient.ragEval.getEvaluationList.query({ knowledgeBaseId });
  };

  startEvaluationTask = async (id: number) => {
    return lambdaClient.ragEval.startEvaluationTask.mutate({ id });
  };

  removeEvaluation = async (id: number): Promise<void> => {
    await lambdaClient.ragEval.removeEvaluation.mutate({ id });
  };

  checkEvaluationStatus = async (id: number): Promise<{ success: boolean }> => {
    return lambdaClient.ragEval.checkEvaluationStatus.query({ id });
  };
}

export const ragEvalService = new RAGEvalService();
