import { z } from 'zod';

export interface EvalDatasetRecordRefFile {
  fileType: string;
  id: string;
  name: string;
}
export interface EvalDatasetRecord {
  createdAt: Date;
  id: string;
  ideal?: string | null;

  metadata: any;

  question?: string | null;

  /**
   * The reference files for the question
   */
  referenceFiles?: EvalDatasetRecordRefFile[] | null;
}

export const insertEvalDatasetRecordSchema = z.object({
  ideal: z.string().optional(),

  question: z.string(),

  referenceFiles: z.string().or(z.array(z.string())).optional(),
});

export type InsertEvalDatasetRecord = z.infer<typeof insertEvalDatasetRecordSchema>;

export interface RAGEvalDataSetItem {
  createdAt: Date;
  description?: string | null;
  id: string;
  name: string;
  updatedAt: Date;
}

export const insertEvalDatasetsSchema = z.object({
  description: z.string().optional(),
  knowledgeBaseId: z.string(),
  name: z.string(),
});

export type CreateNewEvalDatasets = z.infer<typeof insertEvalDatasetsSchema>;
