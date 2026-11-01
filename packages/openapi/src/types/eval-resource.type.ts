import { z } from 'zod';

export const EvalIdSchema = z.string().min(1).max(128);
export const EvalResourceIdSchema = z.object({ id: EvalIdSchema });
export const EvalDatasetPathSchema = z.object({ datasetId: EvalIdSchema });
export const EvalPaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(1000000).optional(),
  page: z.coerce.number().int().min(1).max(1000000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});
export const evalPagination = (query: z.infer<typeof EvalPaginationSchema>) => ({
  limit: query.limit ?? query.pageSize ?? 20,
  offset: query.offset ?? ((query.page ?? 1) - 1) * (query.limit ?? query.pageSize ?? 20),
});
export const EvalModeSchema = z.enum([
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
  'factuality',
  'answer-relevance',
  'similar',
  'levenshtein',
  'rubric',
  'external',
]);
const json = z.record(z.string(), z.unknown());
const name = z.string().trim().min(1).max(255);
const AnswerExtractorSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('regex'),
      pattern: z.string(),
      group: z.number().int().min(0).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('delimiter'),
      delimiter: z.string(),
      position: z.enum(['first', 'last']).optional(),
    })
    .strict(),
  z.object({ type: z.literal('last-line'), trim: z.boolean().optional() }).strict(),
  z
    .object({
      type: z.literal('choice-index'),
      labels: z.array(z.string()).optional(),
      pattern: z.string().optional(),
    })
    .strict(),
]);
export const CreateBenchmarkSchema = z
  .object({
    id: EvalIdSchema.optional(),
    identifier: name,
    name,
    description: z.string().max(10000).nullable().optional(),
    metadata: json.nullable().optional(),
    referenceUrl: z.url().nullable().optional(),
    rubrics: z
      .array(
        z
          .object({
            id: EvalIdSchema,
            name,
            type: EvalModeSchema,
            weight: z.number().min(0),
            threshold: z.number().optional(),
            extractor: AnswerExtractorSchema.optional(),
            config: z.union([
              z.object({ value: z.string(), threshold: z.number().optional() }).strict(),
              z.object({ value: z.number(), tolerance: z.number().optional() }),
              z.object({ pattern: z.string() }),
              z.object({ code: z.string() }),
              z.object({
                criteria: z.string(),
                model: z.string().optional(),
                provider: z.string().optional(),
                systemRole: z.string().optional(),
              }),
              z
                .object({ values: z.array(z.string()), caseSensitive: z.boolean().optional() })
                .strict(),
              z.object({ schema: json }).strict(),
              z
                .object({
                  extractor: AnswerExtractorSchema,
                  innerMatcher: EvalModeSchema.optional(),
                })
                .strict(),
            ]),
          })
          .strict(),
      )
      .max(100)
      .default([]),
  })
  .strict();
export const UpdateBenchmarkSchema = CreateBenchmarkSchema.omit({ id: true }).partial();
export const CreateDatasetSchema = z
  .object({
    id: EvalIdSchema.optional(),
    identifier: name,
    name,
    benchmarkId: EvalIdSchema.nullable().optional(),
    description: z.string().max(10000).nullable().optional(),
    metadata: json.nullable().optional(),
    evalConfig: json.nullable().optional(),
    evalMode: EvalModeSchema.nullable().optional(),
  })
  .strict();
export const UpdateDatasetSchema = CreateDatasetSchema.omit({ id: true }).partial();
export const ListDatasetsSchema = EvalPaginationSchema.extend({
  benchmarkId: EvalIdSchema.optional(),
});
export const EvalMessageSchema = z
  .object({
    content: z.string(),
    role: z.enum(['user', 'assistant', 'system', 'tool']),
    id: EvalIdSchema.optional(),
    parentId: EvalIdSchema.nullable().optional(),
    model: z.string().optional(),
    provider: z.string().optional(),
    createdAt: z.union([z.string(), z.number()]).optional(),
    updatedAt: z.union([z.string(), z.number()]).optional(),
    tools: z.array(json).optional(),
    tool_call_id: z.string().optional(),
    metadata: json.optional(),
    reasoning: json.optional(),
    plugin: json.optional(),
    pluginState: json.optional(),
    pluginError: json.optional(),
    pluginIntervention: json.optional(),
    error: json.optional(),
    search: json.optional(),
  })
  .strict();
export const CreateTestCaseSchema = z
  .object({
    id: EvalIdSchema.optional(),
    input: z.string(),
    expected: z.string().optional(),
    category: z.string().optional(),
    choices: z.array(z.string()).optional(),
    environment: z
      .object({
        envPrompt: z.string().optional(),
        toolForwarding: z
          .record(
            z.string(),
            z
              .object({ endpoint: z.url(), timeoutMs: z.number().int().positive().optional() })
              .strict(),
          )
          .optional(),
      })
      .strict()
      .optional(),
    messages: z.array(EvalMessageSchema).max(1000).optional(),
    caseId: EvalIdSchema.optional(),
    sortOrder: z.number().int().min(0).optional(),
    evalMode: EvalModeSchema.nullable().optional(),
    evalConfig: json.nullable().optional(),
  })
  .strict();
export const UpdateTestCaseSchema = CreateTestCaseSchema.omit({ id: true }).partial();
export type CreateBenchmark = z.infer<typeof CreateBenchmarkSchema>;
export type CreateDataset = z.infer<typeof CreateDatasetSchema>;
export type CreateTestCase = z.infer<typeof CreateTestCaseSchema>;
export type EvalPagination = z.infer<typeof EvalPaginationSchema>;
