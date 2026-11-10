import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';

import { getAllScopePermissions } from '@/utils/rbac';

import { zValidator } from '../common/validator';
import { EvalController } from '../controllers/eval.controller';
import { EvalResourceController } from '../controllers/eval-resource.controller';
import { requireAuth } from '../middleware/auth';
import {
  requireAnyPermissionWithApiKeyScope,
  requireApiKeyScope,
} from '../middleware/permission-check';
import {
  CreateEvalRunRequestSchema,
  EvalBatchReportSchema,
  EvalReportSchema,
  EvalRunIdParamSchema,
  EvalRunListQuerySchema,
  EvalRunTopicListQuerySchema,
  EvalRunTopicPathSchema,
  EvalSetStatusSchema,
} from '../types/eval.type';
import {
  CreateBenchmarkSchema,
  CreateDatasetSchema,
  CreateTestCaseSchema,
  EvalDatasetPathSchema,
  EvalPaginationSchema,
  EvalResourceIdSchema,
  ListDatasetsSchema,
  UpdateBenchmarkSchema,
  UpdateDatasetSchema,
  UpdateTestCaseSchema,
} from '../types/eval-resource.type';

const app = new Hono();
const requireRead = requireAnyPermissionWithApiKeyScope(
  getAllScopePermissions('AGENT_READ'),
  'eval:read',
);
const requireWrite = requireAnyPermissionWithApiKeyScope(
  getAllScopePermissions('AGENT_UPDATE'),
  'eval:write',
);

app.post(
  '/runs',
  describeRoute({
    description: 'Queues an asynchronous QStash-backed evaluation run and returns immediately.',
    summary: 'Create an eval run',
    tags: ['eval'],
  }),
  requireAuth,
  requireWrite,
  zValidator('json', CreateEvalRunRequestSchema),
  async (c, next) => {
    if (c.req.valid('json').executionMode === 'external') return next();
    return requireApiKeyScope('model:invoke')(c, async () => {
      await requireApiKeyScope('chat:write')(c, next);
    });
  },
  async (c) => new EvalController().createRun(c),
);

app.get(
  '/runs',
  describeRoute({ summary: 'List eval runs', tags: ['eval'] }),
  requireAuth,
  requireRead,
  zValidator('query', EvalRunListQuerySchema),
  async (c) => new EvalController().listRuns(c),
);

app.get(
  '/runs/:id/topics',
  describeRoute({ summary: 'List topic results of an eval run', tags: ['eval'] }),
  requireAuth,
  requireRead,
  zValidator('param', EvalRunIdParamSchema),
  zValidator('query', EvalRunTopicListQuerySchema),
  async (c) => new EvalController().getRunTopics(c),
);

app.get(
  '/runs/:id',
  requireAuth,
  requireRead,
  zValidator('param', EvalRunIdParamSchema),
  async (c) => new EvalController().getRun(c),
);

app.get(
  '/runs/:id/results',
  requireAuth,
  requireRead,
  zValidator('param', EvalRunIdParamSchema),
  zValidator('query', EvalRunTopicListQuerySchema),
  async (c) => new EvalController().getRunResults(c),
);

app.post(
  '/benchmarks',
  describeRoute({
    summary: 'createBenchmark',
    description:
      'Creates accept an optional id: an identical replay returns the resource; conflicting id or identifier returns 409. Lists are paginated.',
    tags: ['eval'],
  }),
  requireAuth,
  requireWrite,
  zValidator('json', CreateBenchmarkSchema),
  async (c) => new EvalResourceController().createBenchmark(c),
);

app.get(
  '/benchmarks',
  describeRoute({
    summary: 'listBenchmarks',
    description:
      'Creates accept an optional id: an identical replay returns the resource; conflicting id or identifier returns 409. Lists are paginated.',
    tags: ['eval'],
  }),
  requireAuth,
  requireRead,
  zValidator('query', EvalPaginationSchema),
  async (c) => new EvalResourceController().listBenchmarks(c),
);

app.get(
  '/benchmarks/:id',
  describeRoute({
    summary: 'getBenchmark',
    description:
      'Creates accept an optional id: an identical replay returns the resource; conflicting id or identifier returns 409. Lists are paginated.',
    tags: ['eval'],
  }),
  requireAuth,
  requireRead,
  zValidator('param', EvalResourceIdSchema),
  async (c) => new EvalResourceController().getBenchmark(c),
);

app.patch(
  '/benchmarks/:id',
  describeRoute({
    summary: 'updateBenchmark',
    description:
      'Creates accept an optional id: an identical replay returns the resource; conflicting id or identifier returns 409. Lists are paginated.',
    tags: ['eval'],
  }),
  requireAuth,
  requireWrite,
  zValidator('param', EvalResourceIdSchema),
  zValidator('json', UpdateBenchmarkSchema),
  async (c) => new EvalResourceController().updateBenchmark(c),
);

app.delete(
  '/benchmarks/:id',
  describeRoute({
    summary: 'deleteBenchmark',
    description:
      'Creates accept an optional id: an identical replay returns the resource; conflicting id or identifier returns 409. Lists are paginated.',
    tags: ['eval'],
  }),
  requireAuth,
  requireWrite,
  zValidator('param', EvalResourceIdSchema),
  async (c) => new EvalResourceController().deleteBenchmark(c),
);

app.post(
  '/datasets',
  describeRoute({
    summary: 'createDataset',
    description:
      'Creates accept an optional id: an identical replay returns the resource; conflicting id or identifier returns 409. Lists are paginated.',
    tags: ['eval'],
  }),
  requireAuth,
  requireWrite,
  zValidator('json', CreateDatasetSchema),
  async (c) => new EvalResourceController().createDataset(c),
);

app.get(
  '/datasets',
  describeRoute({
    summary: 'listDatasets',
    description:
      'Creates accept an optional id: an identical replay returns the resource; conflicting id or identifier returns 409. Lists are paginated.',
    tags: ['eval'],
  }),
  requireAuth,
  requireRead,
  zValidator('query', ListDatasetsSchema),
  async (c) => new EvalResourceController().listDatasets(c),
);

app.get(
  '/datasets/:id',
  describeRoute({
    summary: 'getDataset',
    description:
      'Creates accept an optional id: an identical replay returns the resource; conflicting id or identifier returns 409. Lists are paginated.',
    tags: ['eval'],
  }),
  requireAuth,
  requireRead,
  zValidator('param', EvalResourceIdSchema),
  async (c) => new EvalResourceController().getDataset(c),
);

app.patch(
  '/datasets/:id',
  describeRoute({
    summary: 'updateDataset',
    description:
      'Creates accept an optional id: an identical replay returns the resource; conflicting id or identifier returns 409. Lists are paginated.',
    tags: ['eval'],
  }),
  requireAuth,
  requireWrite,
  zValidator('param', EvalResourceIdSchema),
  zValidator('json', UpdateDatasetSchema),
  async (c) => new EvalResourceController().updateDataset(c),
);

app.delete(
  '/datasets/:id',
  describeRoute({
    summary: 'deleteDataset',
    description:
      'Creates accept an optional id: an identical replay returns the resource; conflicting id or identifier returns 409. Lists are paginated.',
    tags: ['eval'],
  }),
  requireAuth,
  requireWrite,
  zValidator('param', EvalResourceIdSchema),
  async (c) => new EvalResourceController().deleteDataset(c),
);

app.post(
  '/datasets/:datasetId/test-cases',
  describeRoute({
    summary: 'createTestCase',
    description:
      'Creates accept an optional id: an identical replay returns the resource; conflicting id or identifier returns 409. Lists are paginated.',
    tags: ['eval'],
  }),
  requireAuth,
  requireWrite,
  zValidator('param', EvalDatasetPathSchema),
  zValidator('json', CreateTestCaseSchema),
  async (c) => new EvalResourceController().createTestCase(c),
);

app.get(
  '/datasets/:datasetId/test-cases',
  describeRoute({
    summary: 'listTestCases',
    description:
      'Creates accept an optional id: an identical replay returns the resource; conflicting id or identifier returns 409. Lists are paginated.',
    tags: ['eval'],
  }),
  requireAuth,
  requireRead,
  zValidator('param', EvalDatasetPathSchema),
  zValidator('query', EvalPaginationSchema),
  async (c) => new EvalResourceController().listTestCases(c),
);

app.get(
  '/test-cases/:id',
  describeRoute({
    summary: 'getTestCase',
    description:
      'Creates accept an optional id: an identical replay returns the resource; conflicting id or identifier returns 409. Lists are paginated.',
    tags: ['eval'],
  }),
  requireAuth,
  requireRead,
  zValidator('param', EvalResourceIdSchema),
  async (c) => new EvalResourceController().getTestCase(c),
);

app.patch(
  '/test-cases/:id',
  describeRoute({
    summary: 'updateTestCase',
    description:
      'Creates accept an optional id: an identical replay returns the resource; conflicting id or identifier returns 409. Lists are paginated.',
    tags: ['eval'],
  }),
  requireAuth,
  requireWrite,
  zValidator('param', EvalResourceIdSchema),
  zValidator('json', UpdateTestCaseSchema),
  async (c) => new EvalResourceController().updateTestCase(c),
);

app.delete(
  '/test-cases/:id',
  describeRoute({
    summary: 'deleteTestCase',
    description:
      'Creates accept an optional id: an identical replay returns the resource; conflicting id or identifier returns 409. Lists are paginated.',
    tags: ['eval'],
  }),
  requireAuth,
  requireWrite,
  zValidator('param', EvalResourceIdSchema),
  async (c) => new EvalResourceController().deleteTestCase(c),
);

app.post(
  '/runs/:id/claim',
  describeRoute({
    summary: 'claim',
    tags: ['eval'],
    description:
      'Claim: one pending worker succeeds, others receive 409. Reports: identical replays succeed; different results conflict. Batches are atomic. External workers can supply testCaseId to associate their own topic with a dataset case on first report. Retry: only terminal runs, concurrent repeats conflict.',
  }),
  requireAuth,
  requireWrite,
  zValidator('param', EvalRunIdParamSchema),
  async (c) => new EvalController().claim(c),
);

app.patch(
  '/runs/:id/status',
  describeRoute({
    summary: 'setStatus',
    tags: ['eval'],
    description:
      'Claim: one pending worker succeeds, others receive 409. Reports: identical replays succeed; different results conflict. Batches are atomic. External workers can supply testCaseId to associate their own topic with a dataset case on first report. Retry: only terminal runs, concurrent repeats conflict.',
  }),
  requireAuth,
  requireWrite,
  zValidator('param', EvalRunIdParamSchema),
  zValidator('json', EvalSetStatusSchema),
  async (c) => new EvalController().setStatus(c),
);

app.post(
  '/runs/:id/retry-errors',
  describeRoute({
    summary: 'retryErrors',
    tags: ['eval'],
    description:
      'Claim: one pending worker succeeds, others receive 409. Reports: identical replays succeed; different results conflict. Batches are atomic. External workers can supply testCaseId to associate their own topic with a dataset case on first report. Retry: only terminal runs, concurrent repeats conflict.',
  }),
  requireAuth,
  requireWrite,
  zValidator('param', EvalRunIdParamSchema),
  async (c) => new EvalController().retryErrors(c),
);

app.put(
  '/runs/:runId/topics/:topicId/result',
  describeRoute({
    summary: 'report',
    tags: ['eval'],
    description:
      'Claim: one pending worker succeeds, others receive 409. Reports: identical replays succeed; different results conflict. Batches are atomic. External workers can supply testCaseId to associate their own topic with a dataset case on first report. Retry: only terminal runs, concurrent repeats conflict.',
  }),
  requireAuth,
  requireWrite,
  zValidator('param', EvalRunTopicPathSchema),
  zValidator('json', EvalReportSchema),
  async (c) => new EvalController().report(c),
);

app.post(
  '/runs/:id/results',
  describeRoute({
    summary: 'reportBatch',
    tags: ['eval'],
    description:
      'Claim: one pending worker succeeds, others receive 409. Reports: identical replays succeed; different results conflict. Batches are atomic. External workers can supply testCaseId to associate their own topic with a dataset case on first report. Retry: only terminal runs, concurrent repeats conflict.',
  }),
  requireAuth,
  requireWrite,
  zValidator('param', EvalRunIdParamSchema),
  zValidator('json', EvalBatchReportSchema),
  async (c) => new EvalController().reportBatch(c),
);

export default app;
