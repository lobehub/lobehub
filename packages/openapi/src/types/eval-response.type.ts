import { z } from 'zod';

import {
  CreateBenchmarkSchema,
  CreateDatasetSchema,
  CreateTestCaseSchema,
} from './eval-resource.type';

const id = z.string();
const timestamp = z.iso.datetime();
const json = z.record(z.string(), z.unknown());
const dates = { createdAt: timestamp, updatedAt: timestamp };
const nullable = z.string().nullable();
const benchmark = CreateBenchmarkSchema.extend({
  id,
  ...dates,
  isSystem: z.boolean(),
  description: nullable,
  metadata: json.nullable(),
  referenceUrl: nullable,
});
const dataset = CreateDatasetSchema.extend({
  id,
  ...dates,
  benchmarkId: nullable,
  sourceExperimentId: nullable,
  description: nullable,
  evalMode: nullable,
  evalConfig: json.nullable(),
  metadata: json.nullable(),
  testCaseCount: z.number().int(),
});
const testCase = CreateTestCaseSchema.extend({
  id,
  ...dates,
  datasetId: id,
  content: json,
  metadata: json.nullable(),
  sortOrder: z.number().nullable(),
});
const run = z
  .object({
    id,
    ...dates,
    config: json,
    executionMode: z.enum(['internal', 'external']),
    datasetId: id,
    experimentId: nullable,
    parentRunId: nullable,
    status: z.enum(['idle', 'pending', 'running', 'external', 'completed', 'failed', 'aborted']),
    targetAgentId: nullable,
    name: nullable,
    metrics: json.nullable(),
    startedAt: timestamp.nullable(),
  })
  .strict();
const runTopic = z
  .object({
    createdAt: timestamp,
    evalResult: json.nullable(),
    passed: z.boolean().nullable(),
    runId: id,
    score: z.number().nullable(),
    status: nullable,
    testCaseId: id,
    topicId: id,
    input: z.string(),
  })
  .strict();
const runResult = runTopic
  .omit({ evalResult: true, runId: true })
  .extend({ result: json.nullable() });
const receipt = z
  .object({
    idempotent: z.boolean(),
    reportedThreads: z.number(),
    runId: id,
    runStatus: z.string().optional(),
    success: z.boolean(),
    threadId: id.optional(),
    topicFinalized: z.boolean(),
    topicId: id,
    totalThreads: z.number(),
  })
  .strict();
const page = (key: string, schema: z.ZodType) =>
  z.object({ [key]: z.array(schema), total: z.number().int().min(0) });

export const evalResponseSchema = (method: string, rest: string) => {
  if (method === 'delete') return z.toJSONSchema(z.object({ id }).strict());
  if (rest.endsWith('/retry-errors'))
    return z.toJSONSchema(z.object({ runId: id, retryCount: z.number() }).strict());
  if (rest.endsWith('/result')) return z.toJSONSchema(receipt);
  if (rest.endsWith('/results') && method === 'post')
    return z.toJSONSchema(
      z
        .object({ items: z.array(receipt), runId: id, runStatus: z.string(), success: z.boolean() })
        .strict(),
    );
  if (rest.endsWith('/results'))
    return z.toJSONSchema(page('results', runResult).extend({ runId: id }));
  if (rest.endsWith('/topics'))
    return z.toJSONSchema(page('topics', runTopic).extend({ runId: id }));
  if (rest.endsWith('/test-cases'))
    return z.toJSONSchema(method === 'get' ? page('testCases', testCase) : testCase);
  if (rest.startsWith('test-cases/')) return z.toJSONSchema(testCase);
  if (rest.startsWith('benchmarks'))
    return z.toJSONSchema(
      rest === 'benchmarks' && method === 'get' ? page('benchmarks', benchmark) : benchmark,
    );
  if (rest.startsWith('datasets'))
    return z.toJSONSchema(
      rest === 'datasets' && method === 'get' ? page('datasets', dataset) : dataset,
    );
  return z.toJSONSchema(rest === 'runs' && method === 'get' ? page('runs', run) : run);
};
