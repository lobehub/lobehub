import { z } from 'zod';

export enum EvalEvaluationStatus {
  Error = 'Error',
  Pending = 'Pending',
  Processing = 'Processing',
  Success = 'Success',
}

export interface EvaluationRecord {
  answer: string;
  context: string[];
  createdAt: Date;
  id: number;
  ideal: string;
  question: string;
}

export const insertEvaluationSchema = z.object({
  ideal: z.string().optional(),

  question: z.string(),

  referenceFiles: z.string().or(z.array(z.string())).optional(),
});

export type InsertEvaluationRecord = z.infer<typeof insertEvaluationSchema>;

export interface RAGEvalEvaluationItem {
  createdAt: Date;
  dataset: {
    id: string;
    name: string;
  };
  evalRecordsUrl?: string;
  id: string;
  name: string;
  recordsStats: {
    success: number;
    total: number;
  };
  status: EvalEvaluationStatus;
  updatedAt: Date;
}

export const insertEvalEvaluationSchema = z.object({
  datasetId: z.string(),
  description: z.string().optional(),
  knowledgeBaseId: z.string(),
  name: z.string(),
});

export type CreateNewEvalEvaluation = z.infer<typeof insertEvalEvaluationSchema>;
