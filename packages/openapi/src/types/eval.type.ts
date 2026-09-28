import type { EvalRunMetrics, EvalRunTopicResult } from '@lobechat/types';
import { z } from 'zod';

import type {
  PublicEvalDataset,
  PublicEvalRunTopic,
  PublicEvalTestCase,
} from '../helpers/public-fields';
import type { PaginationQueryResponse } from './common.type';
import { EvalPaginationSchema } from './eval-resource.type';

export const CreateEvalRunRequestSchema = z
  .object({
    config: z
      .object({
        maxConcurrency: z.number().int().min(1).max(100).optional(),
        caseSelection: z
          .discriminatedUnion('mode', [
            z.object({ mode: z.literal('all') }).strict(),
            z
              .object({
                mode: z.enum(['include', 'exclude']),
                caseIds: z
                  .array(z.string().trim().min(1))
                  .min(1)
                  .max(10000)
                  .refine((ids) => new Set(ids).size === ids.length),
              })
              .strict(),
          ])
          .optional(),
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
    executionMode: z.enum(['internal', 'external']).optional(),
    experimentId: z.string().min(1).max(128).optional(),
    datasetId: z.string().min(1).max(128),
    id: z.string().min(1).max(128).optional(),
    name: z.string().trim().min(1).max(255).optional(),
    targetAgentId: z.string().min(1).max(128),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.executionMode !== 'external' &&
      (value.config?.caseSelection || value.config?.maxConcurrency !== undefined)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'caseSelection and maxConcurrency require external executionMode',
        path: ['config'],
      });
    if (value.executionMode === 'external' && (value.config?.k ?? 1) > 1)
      ctx.addIssue({
        code: 'custom',
        message: 'External runs only support k=1',
        path: ['config', 'k'],
      });
  });

export const EvalRunIdParamSchema = z.object({ id: z.string().min(1).max(128) });

export const EvalDatasetIdParamSchema = z.object({ id: z.string().min(1).max(128) });

const EvalPaginationQuerySchema = EvalPaginationSchema;

export const EvalRunListQuerySchema = EvalPaginationQuerySchema.extend({
  experimentId: z.string().min(1).max(128).optional(),
  datasetId: z.string().min(1).max(128).optional(),
  status: z
    .enum(['idle', 'pending', 'running', 'completed', 'failed', 'aborted', 'external'])
    .optional(),
});

export const EvalDatasetListQuerySchema = EvalPaginationQuerySchema.extend({
  benchmarkId: z.string().min(1).max(128).optional(),
});

export const EvalRunTopicListQuerySchema = EvalPaginationQuerySchema;

export type CreateEvalRunRequest = z.infer<typeof CreateEvalRunRequestSchema>;
export type EvalRunListQuery = z.infer<typeof EvalRunListQuerySchema>;
export type EvalDatasetListQuery = z.infer<typeof EvalDatasetListQuerySchema>;
export type EvalRunTopicListQuery = z.infer<typeof EvalRunTopicListQuerySchema>;

export interface EvalRunResponse {
  config: Record<string, unknown>;
  createdAt: Date;
  datasetId: string;
  executionMode: 'internal' | 'external';
  experimentId: string | null;
  id: string;
  metrics: EvalRunMetrics | null;
  name: null | string;
  parentRunId: string | null;
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

export type EvalRunListResponse = PaginationQueryResponse<{ runs: EvalRunResponse[] }>;

export type EvalDatasetListResponse = PaginationQueryResponse<{ datasets: PublicEvalDataset[] }>;

export interface EvalDatasetDetailResponse extends PublicEvalDataset {
  testCases: PublicEvalTestCase[];
}

export interface EvalRunTopicResponse extends PublicEvalRunTopic {
  input: string;
}

export type EvalRunTopicListResponse = PaginationQueryResponse<{
  runId: string;
  topics: EvalRunTopicResponse[];
}>;

export const EvalRunTopicPathSchema = z.object({
  runId: z.string().min(1).max(128),
  topicId: z.string().min(1).max(128),
});
export const EvalReportSchema = z
  .object({
    testCaseId: z.string().min(1).max(128).optional(),
    correct: z.boolean(),
    score: z.number(),
    result: z.record(z.string(), z.unknown()).optional(),
    threadId: z.string().min(1).max(128).optional(),
  })
  .strict();
export const EvalBatchReportSchema = z
  .object({
    items: z
      .array(EvalReportSchema.extend({ topicId: z.string().min(1).max(128) }))
      .min(1)
      .max(100),
  })
  .strict();
export const EvalSetStatusSchema = z
  .object({ status: z.enum(['running', 'external', 'completed', 'failed', 'aborted']) })
  .strict();
export type EvalReport = z.infer<typeof EvalReportSchema>;
export type EvalBatchReport = z.infer<typeof EvalBatchReportSchema>;
export type EvalSetStatus = z.infer<typeof EvalSetStatusSchema>;
