import { z } from 'zod';

import { pageInfoShape, totalShape } from '../helpers/pagination';
import { dateTimeSchema, jsonObjectSchema } from './common.type';
import { AnswerExtractorSchema, EvalMessageSchema, RubricConfigSchema } from './eval-resource.type';

// ==================== Response Schemas ====================

const total = z.number().int().min(0);

/** Every evaluator a stored rubric / dataset / case can name (the DB enum). */
const StoredEvalModeSchema = z.enum([
  'equals',
  'contains',
  'regex',
  'starts-with',
  'ends-with',
  'any-of',
  'numeric',
  'extract-match',
  'json-schema',
  'javascript',
  'python',
  'llm-rubric',
  'rule-checklist',
  'factuality',
  'answer-relevance',
  'similar',
  'levenshtein',
  'rubric',
  'external',
]);

const RunStatusSchema = z.enum([
  'idle',
  'pending',
  'running',
  'completed',
  'failed',
  'aborted',
  'external',
]);

const RunTopicStatusSchema = z.enum([
  'pending',
  'running',
  'passed',
  'failed',
  'error',
  'timeout',
  'external',
  'completed',
  'judge_error',
]);

// ---------- Resources (benchmarks / datasets / test cases) ----------

export const EvalBenchmarkRubricSchema = z
  .object({
    config: RubricConfigSchema,
    extractor: AnswerExtractorSchema.optional(),
    id: z.string(),
    name: z.string(),
    threshold: z.number().optional(),
    type: StoredEvalModeSchema,
    weight: z.number(),
  })
  .strict()
  .meta({ id: 'EvalBenchmarkRubric' });

/** `projectBenchmark` in eval-resource.service. */
export const EvalBenchmarkSchema = z
  .object({
    createdAt: dateTimeSchema,
    description: z.string().nullable(),
    id: z.string(),
    identifier: z.string(),
    isSystem: z.boolean(),
    metadata: jsonObjectSchema.nullable(),
    name: z.string(),
    referenceUrl: z.string().nullable(),
    rubrics: z.array(EvalBenchmarkRubricSchema),
    updatedAt: dateTimeSchema,
  })
  .strict()
  .meta({ id: 'EvalBenchmark' });

export const EvalBenchmarkListSchema = z
  .object({ ...pageInfoShape, benchmarks: z.array(EvalBenchmarkSchema), ...totalShape })
  .strict();

/** `projectPublicEvalDataset` + the dataset's case count (eval-resource.service). */
export const EvalDatasetSchema = z
  .object({
    benchmarkId: z.string().nullable(),
    createdAt: dateTimeSchema,
    description: z.string().nullable(),
    evalConfig: jsonObjectSchema.nullable(),
    evalMode: StoredEvalModeSchema.nullable(),
    id: z.string(),
    identifier: z.string(),
    metadata: jsonObjectSchema.nullable(),
    name: z.string(),
    sourceExperimentId: z.string().nullable(),
    testCaseCount: total,
    updatedAt: dateTimeSchema,
  })
  .strict()
  .meta({ id: 'EvalDataset' });

export const EvalDatasetListSchema = z
  .object({ ...pageInfoShape, datasets: z.array(EvalDatasetSchema), ...totalShape })
  .strict();

/** A history message restored before the case input (`ImportedMessage`). */
const EvalStoredMessageSchema = z.object(EvalMessageSchema.shape);

/** The stored case content (`EvalTestCaseContent`). */
const EvalTestCaseContentSchema = z.object({
  category: z.string().optional(),
  choices: z.array(z.string()).optional(),
  /** Per-case runtime configuration (`EvalCaseEnvironment`). */
  environment: jsonObjectSchema.optional(),
  expected: z.string().optional(),
  input: z.string(),
  messages: z.array(EvalStoredMessageSchema).optional(),
});

/**
 * `projectTestCase` in eval-resource.service: the public columns plus the
 * content fields lifted to the top level. Lifted fields absent from the stored
 * content are omitted.
 */
export const EvalTestCaseSchema = z
  .object({
    caseId: z.string().optional(),
    category: z.string().optional(),
    choices: z.array(z.string()).optional(),
    content: EvalTestCaseContentSchema,
    createdAt: dateTimeSchema,
    datasetId: z.string(),
    environment: jsonObjectSchema.optional(),
    evalConfig: jsonObjectSchema.nullable(),
    evalMode: StoredEvalModeSchema.nullable(),
    expected: z.string().optional(),
    id: z.string(),
    input: z.string(),
    messages: z.array(EvalStoredMessageSchema).optional(),
    metadata: jsonObjectSchema.nullable(),
    sortOrder: z.number().int().nullable(),
    updatedAt: dateTimeSchema,
  })
  .strict()
  .meta({ id: 'EvalTestCase' });

export const EvalTestCaseListSchema = z
  .object({ ...pageInfoShape, testCases: z.array(EvalTestCaseSchema), ...totalShape })
  .strict();

// ---------- Runs ----------

/** Run aggregates (`EvalRunMetrics`); a run that was reset may carry only progress fields. */
export const EvalRunMetricsSchema = z
  .object({
    averageScore: z.number().optional(),
    completedCases: z.number().optional(),
    cost: z.number().optional(),
    duration: z.number().optional(),
    errorCases: z.number().optional(),
    externalCases: z.number().optional(),
    failedCases: z.number().optional(),
    judgeErrorCases: z.number().optional(),
    llmCalls: z.number().optional(),
    passAllAt: z.record(z.string(), z.number()).optional(),
    passAllK: z.number().optional(),
    passAnyAt: z.record(z.string(), z.number()).optional(),
    passAtK: z.number().optional(),
    passedCases: z.number().optional(),
    passRate: z.number().optional(),
    perCaseCost: z.number().optional(),
    perCaseLlmCalls: z.number().optional(),
    perCaseSteps: z.number().optional(),
    perCaseTokens: z.number().optional(),
    perCaseToolCalls: z.number().optional(),
    rubricScores: z.record(z.string(), z.number()).optional(),
    steps: z.number().optional(),
    timeoutCases: z.number().optional(),
    tokens: z.number().optional(),
    toolCalls: z.number().optional(),
    totalCases: z.number().optional(),
    totalCost: z.number().optional(),
    totalDuration: z.number().optional(),
    totalTokens: z.number().optional(),
  })
  .meta({ id: 'EvalRunMetrics' });

const EvalCaseSelectionSchema = z
  .object({
    caseIds: z.array(z.string()).optional(),
    mode: z.enum(['all', 'include', 'exclude']),
  })
  .strict();

/** `projectRun` in helpers/eval-run. */
export const EvalRunSchema = z
  .object({
    config: z
      .object({
        caseSelection: EvalCaseSelectionSchema.optional(),
        k: z.number().int(),
        maxConcurrency: z.number().int().optional(),
        maxSteps: z.number().int().optional(),
        timeout: z.number().int().optional(),
      })
      .strict(),
    createdAt: dateTimeSchema,
    datasetId: z.string(),
    executionMode: z.enum(['internal', 'external']),
    experimentId: z.string().nullable(),
    id: z.string(),
    metrics: EvalRunMetricsSchema.nullable(),
    name: z.string().nullable(),
    parentRunId: z.string().nullable(),
    startedAt: dateTimeSchema.nullable(),
    status: RunStatusSchema,
    targetAgentId: z.string().nullable(),
    updatedAt: dateTimeSchema,
  })
  .strict()
  .meta({ id: 'EvalRun' });

export const EvalRunListSchema = z
  .object({ ...pageInfoShape, runs: z.array(EvalRunSchema), ...totalShape })
  .strict();

export const EvalRubricScoreSchema = z
  .object({
    reason: z.string().optional(),
    rubricId: z.string(),
    score: z.number(),
    verdicts: z
      .array(
        z
          .object({
            reason: z.string().optional(),
            rule: z.string(),
            verdict: z.enum(['satisfied', 'unverifiable', 'violated']),
          })
          .strict(),
      )
      .optional(),
  })
  .strict()
  .meta({ id: 'EvalRubricScore' });

/** One pass@k attempt, as `projectResult` in eval.service exposes it. */
export const EvalThreadResultSchema = z
  .object({
    completionReason: z.string().optional(),
    cost: z.number().optional(),
    duration: z.number().optional(),
    error: z.string().optional(),
    llmCalls: z.number().optional(),
    passed: z.boolean().optional(),
    rubricScores: z.array(EvalRubricScoreSchema).optional(),
    score: z.number().optional(),
    status: z
      .enum([
        'error',
        'external',
        'failed',
        'passed',
        'running',
        'timeout',
        'completed',
        'judge_error',
      ])
      .optional(),
    steps: z.number().optional(),
    threadId: z.string(),
    tokens: z.number().optional(),
    toolCalls: z.number().optional(),
  })
  .strict()
  .meta({ id: 'EvalThreadResult' });

const evalResultFields = {
  awaitingExternalEval: z.boolean().optional(),
  completionReason: z.string().optional(),
  cost: z.number().optional(),
  duration: z.number().optional(),
  error: z.string().optional(),
  /** Opaque evidence reported by an external evaluator. */
  externalResult: jsonObjectSchema.optional(),
  /** Per-thread external evidence for k > 1 runs, keyed by thread id. */
  externalThreadResults: jsonObjectSchema.optional(),
  extractedAnswer: z.string().optional(),
  llmCalls: z.number().optional(),
  passAllK: z.boolean().optional(),
  passAtK: z.boolean().optional(),
  rubricScores: z.array(EvalRubricScoreSchema).optional(),
  steps: z.number().optional(),
  threads: z.array(EvalThreadResultSchema).optional(),
  tokens: z.number().optional(),
  toolCalls: z.number().optional(),
  totalCost: z.number().optional(),
  totalDuration: z.number().optional(),
  totalTokens: z.number().optional(),
};

/** The scored outcome of one case, projected by `projectResult` in eval.service. */
export const EvalCaseResultSchema = z
  .object(evalResultFields)
  .strict()
  .meta({ id: 'EvalCaseResult' });

const judgesSchema = z.array(z.object({ model: z.string(), provider: z.string() }).strict());

/** A stored pass@k attempt (`EvalThreadResult`), including execution bookkeeping. */
const EvalStoredThreadResultSchema = z.object({
  ...EvalThreadResultSchema.shape,
  errorPhase: z.literal('judge').optional(),
  executionId: z.string().optional(),
  judgeError: z.string().optional(),
  judges: judgesSchema.optional(),
  memorySnapshot: jsonObjectSchema.optional(),
  operationId: z.string().optional(),
});

/**
 * The stored `evalResult` column (`EvalRunTopicResult`) as `GET /runs/{id}/topics`
 * returns it unprojected: the scored fields plus execution bookkeeping.
 */
export const EvalStoredResultSchema = z
  .object({
    ...evalResultFields,
    dispatchedAt: z.string().optional(),
    errorDetail: z.unknown().optional(),
    errorPhase: z.literal('judge').optional(),
    executionId: z.string().optional(),
    judgeError: z.string().optional(),
    judges: judgesSchema.optional(),
    /** Final state of the attempt's isolated Memory. */
    memorySnapshot: jsonObjectSchema.optional(),
    operationId: z.string().optional(),
    threads: z.array(EvalStoredThreadResultSchema).optional(),
  })
  .meta({ id: 'EvalStoredResult' });

/** One case of a run in `GET /runs/{id}/results`. */
export const EvalRunResultSchema = z
  .object({
    createdAt: dateTimeSchema,
    input: z.string(),
    passed: z.boolean().nullable(),
    result: EvalCaseResultSchema.nullable(),
    score: z.number().nullable(),
    status: RunTopicStatusSchema.nullable(),
    testCaseId: z.string(),
    topicId: z.string(),
  })
  .strict()
  .meta({ id: 'EvalRunResult' });

export const EvalRunResultListSchema = z
  .object({
    ...pageInfoShape,
    results: z.array(EvalRunResultSchema),
    runId: z.string(),
    ...totalShape,
  })
  .strict();

/** One case topic of a run in `GET /runs/{id}/topics`. */
export const EvalRunTopicSchema = z
  .object({
    createdAt: dateTimeSchema,
    evalResult: EvalStoredResultSchema.nullable(),
    input: z.string(),
    passed: z.boolean().nullable(),
    runId: z.string(),
    score: z.number().nullable(),
    status: RunTopicStatusSchema.nullable(),
    testCaseId: z.string(),
    topicId: z.string(),
  })
  .strict()
  .meta({ id: 'EvalRunTopic' });

export const EvalRunTopicListSchema = z
  .object({
    ...pageInfoShape,
    runId: z.string(),
    topics: z.array(EvalRunTopicSchema),
    ...totalShape,
  })
  .strict();

// ---------- External worker lifecycle ----------

export const EvalRetryErrorsSchema = z
  .object({ retryCount: total, runId: z.string() })
  .strict()
  .meta({ id: 'EvalRetryErrors' });

const reportReceiptFields = {
  /** True when the call replayed a result that was already recorded. */
  idempotent: z.boolean(),
  reportedThreads: total,
  runId: z.string(),
  success: z.literal(true),
  /** Echoes the request's `threadId`; absent when none was sent. */
  threadId: z.string().optional(),
  topicFinalized: z.boolean(),
  topicId: z.string(),
  totalThreads: total,
};

/** What `applyReportResult` answers for one reported item of a batch. */
export const EvalReportReceiptSchema = z
  .object(reportReceiptFields)
  .strict()
  .meta({ id: 'EvalReportReceipt' });

/** `PUT /runs/{runId}/topics/{topicId}/result`: the receipt plus the run's status after it. */
export const EvalReportResultSchema = z
  .object({ ...reportReceiptFields, runStatus: RunStatusSchema })
  .strict()
  .meta({ id: 'EvalReportResult' });

export const EvalBatchReportResultSchema = z
  .object({
    items: z.array(EvalReportReceiptSchema),
    runId: z.string(),
    runStatus: RunStatusSchema,
    success: z.literal(true),
  })
  .strict()
  .meta({ id: 'EvalBatchReportResult' });
