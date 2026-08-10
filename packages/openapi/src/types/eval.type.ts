import type { EvalRunMetrics, EvalRunTopicResult } from '@lobechat/types';
import { z } from 'zod';

export const CreateEvalRunRequestSchema = z
  .object({
    config: z
      .object({
        k: z.number().int().min(1).max(10).optional(),
        maxSteps: z.number().int().min(1).max(1000).optional(),
        timeout: z
          .number()
          .int()
          .min(60_000)
          .max(6 * 3_600_000)
          .optional(),
      })
      .strict()
      .optional(),
    datasetId: z.string().min(1).max(128),
    id: z.string().min(1).max(128).optional(),
    name: z.string().trim().min(1).max(255).optional(),
    targetAgentId: z.string().min(1).max(128),
  })
  .strict();

export const EvalRunIdParamSchema = z.object({ id: z.string().min(1).max(128) });

export type CreateEvalRunRequest = z.infer<typeof CreateEvalRunRequestSchema>;

export interface EvalRunResponse {
  createdAt: Date;
  datasetId: string;
  id: string;
  metrics: EvalRunMetrics | null;
  name: null | string;
  startedAt: Date | null;
  status: string;
  targetAgentId: null | string;
  updatedAt: Date;
}

export interface EvalRunResultResponse {
  createdAt: Date;
  input: string;
  passed: boolean | null;
  result: EvalRunTopicResult | null;
  score: null | number;
  status: null | string;
  testCaseId: string;
  topicId: string;
}

export interface EvalRunResultsResponse {
  results: EvalRunResultResponse[];
  runId: string;
  total: number;
}
