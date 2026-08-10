import type { EvalRunMetrics, EvalRunTopicResult } from '@lobechat/types';
import { z } from 'zod';

const EvalCaseSelectionSchema = z
  .object({
    caseIds: z.array(z.string().trim().min(1).max(255)).max(10_000).optional(),
    mode: z.enum(['all', 'include', 'exclude']),
  })
  .superRefine((value, ctx) => {
    const ids = value.caseIds ?? [];
    if (value.mode === 'all' && ids.length > 0) {
      ctx.addIssue({ code: 'custom', message: 'caseIds must be empty when mode is all' });
    }
    if (value.mode === 'include' && ids.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'caseIds are required when mode is include' });
    }
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', message: 'caseIds must be unique' });
    }
  })
  .transform((value) => {
    if (value.mode === 'all') return undefined;
    if (value.mode === 'exclude' && !value.caseIds?.length) return undefined;
    return value;
  });

export const CreateEvalRunRequestSchema = z
  .object({
    config: z
      .object({
        caseSelection: EvalCaseSelectionSchema.optional(),
        k: z.number().int().min(1).max(10).optional(),
        maxConcurrency: z.number().int().min(1).max(20).optional(),
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
