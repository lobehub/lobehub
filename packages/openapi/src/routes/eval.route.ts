import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { EvalController } from '../controllers/eval.controller';
import { EvalResourceController } from '../controllers/eval-resource.controller';
import { requireAuth } from '../middleware/auth';
import {
  requireAnyPermissionWithApiKeyScope,
  requireApiKeyScope,
} from '../middleware/permission-check';
import { DeletedResourceSchema } from '../types/common.type';
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
import {
  EvalBatchReportResultSchema,
  EvalBenchmarkListSchema,
  EvalBenchmarkSchema,
  EvalDatasetListSchema,
  EvalDatasetSchema,
  EvalReportResultSchema,
  EvalRetryErrorsSchema,
  EvalRunListSchema,
  EvalRunResultListSchema,
  EvalRunSchema,
  EvalRunTopicListSchema,
  EvalTestCaseListSchema,
  EvalTestCaseSchema,
} from '../types/eval-response.type';

const RESOURCE_DESCRIPTION =
  'Creates accept an optional id: an identical replay returns the resource; conflicting id or identifier returns 409. Lists are paginated.';
const LIFECYCLE_DESCRIPTION =
  'Claim: one pending worker succeeds, others receive 409. Reports: identical replays succeed; different results conflict. Batches are atomic. External workers can supply testCaseId to associate their own topic with a dataset case on first report. Retry: only terminal runs, concurrent repeats conflict.';

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
  routeDoc({
    data: EvalRunSchema,
    description: 'Queues an asynchronous QStash-backed evaluation run and returns immediately.',
    errors: [404, 409],
    status: 202,
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
  routeDoc({
    data: EvalRunListSchema,
    summary: 'List eval runs',
    tags: ['eval'],
  }),
  requireAuth,
  requireRead,
  zValidator('query', EvalRunListQuerySchema),
  async (c) => new EvalController().listRuns(c),
);

app.get(
  '/runs/:id/topics',
  routeDoc({
    data: EvalRunTopicListSchema,
    errors: [404],
    summary: 'List topic results of an eval run',
    tags: ['eval'],
  }),
  requireAuth,
  requireRead,
  zValidator('param', EvalRunIdParamSchema),
  zValidator('query', EvalRunTopicListQuerySchema),
  async (c) => new EvalController().getRunTopics(c),
);

app.get(
  '/runs/:id',
  routeDoc({
    data: EvalRunSchema,
    errors: [404],
    summary: 'Get an eval run',
    tags: ['eval'],
  }),
  requireAuth,
  requireRead,
  zValidator('param', EvalRunIdParamSchema),
  async (c) => new EvalController().getRun(c),
);

app.get(
  '/runs/:id/results',
  routeDoc({
    data: EvalRunResultListSchema,
    errors: [404],
    summary: 'List case results of an eval run',
    tags: ['eval'],
  }),
  requireAuth,
  requireRead,
  zValidator('param', EvalRunIdParamSchema),
  zValidator('query', EvalRunTopicListQuerySchema),
  async (c) => new EvalController().getRunResults(c),
);

app.post(
  '/benchmarks',
  routeDoc({
    data: EvalBenchmarkSchema,
    description: RESOURCE_DESCRIPTION,
    errors: [409],
    status: 201,
    summary: 'Create a benchmark',
    tags: ['eval'],
  }),
  requireAuth,
  requireWrite,
  zValidator('json', CreateBenchmarkSchema),
  async (c) => new EvalResourceController().createBenchmark(c),
);

app.get(
  '/benchmarks',
  routeDoc({
    data: EvalBenchmarkListSchema,
    description: RESOURCE_DESCRIPTION,
    summary: 'List benchmarks',
    tags: ['eval'],
  }),
  requireAuth,
  requireRead,
  zValidator('query', EvalPaginationSchema),
  async (c) => new EvalResourceController().listBenchmarks(c),
);

app.get(
  '/benchmarks/:id',
  routeDoc({
    data: EvalBenchmarkSchema,
    description: RESOURCE_DESCRIPTION,
    errors: [404],
    summary: 'Get a benchmark',
    tags: ['eval'],
  }),
  requireAuth,
  requireRead,
  zValidator('param', EvalResourceIdSchema),
  async (c) => new EvalResourceController().getBenchmark(c),
);

app.patch(
  '/benchmarks/:id',
  routeDoc({
    data: EvalBenchmarkSchema,
    description: RESOURCE_DESCRIPTION,
    errors: [404, 409],
    summary: 'Update a benchmark',
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
  routeDoc({
    data: DeletedResourceSchema,
    description: RESOURCE_DESCRIPTION,
    errors: [404],
    summary: 'Delete a benchmark',
    tags: ['eval'],
  }),
  requireAuth,
  requireWrite,
  zValidator('param', EvalResourceIdSchema),
  async (c) => new EvalResourceController().deleteBenchmark(c),
);

app.post(
  '/datasets',
  routeDoc({
    data: EvalDatasetSchema,
    description: RESOURCE_DESCRIPTION,
    errors: [404, 409],
    status: 201,
    summary: 'Create a dataset',
    tags: ['eval'],
  }),
  requireAuth,
  requireWrite,
  zValidator('json', CreateDatasetSchema),
  async (c) => new EvalResourceController().createDataset(c),
);

app.get(
  '/datasets',
  routeDoc({
    data: EvalDatasetListSchema,
    description: RESOURCE_DESCRIPTION,
    summary: 'List datasets',
    tags: ['eval'],
  }),
  requireAuth,
  requireRead,
  zValidator('query', ListDatasetsSchema),
  async (c) => new EvalResourceController().listDatasets(c),
);

app.get(
  '/datasets/:id',
  routeDoc({
    data: EvalDatasetSchema,
    description: RESOURCE_DESCRIPTION,
    errors: [404],
    summary: 'Get a dataset',
    tags: ['eval'],
  }),
  requireAuth,
  requireRead,
  zValidator('param', EvalResourceIdSchema),
  async (c) => new EvalResourceController().getDataset(c),
);

app.patch(
  '/datasets/:id',
  routeDoc({
    data: EvalDatasetSchema,
    description: RESOURCE_DESCRIPTION,
    errors: [404, 409],
    summary: 'Update a dataset',
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
  routeDoc({
    data: DeletedResourceSchema,
    description: RESOURCE_DESCRIPTION,
    errors: [404],
    summary: 'Delete a dataset',
    tags: ['eval'],
  }),
  requireAuth,
  requireWrite,
  zValidator('param', EvalResourceIdSchema),
  async (c) => new EvalResourceController().deleteDataset(c),
);

app.post(
  '/datasets/:datasetId/test-cases',
  routeDoc({
    data: EvalTestCaseSchema,
    description: RESOURCE_DESCRIPTION,
    errors: [404, 409],
    status: 201,
    summary: 'Create a test case',
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
  routeDoc({
    data: EvalTestCaseListSchema,
    description: RESOURCE_DESCRIPTION,
    errors: [404],
    summary: 'List test cases of a dataset',
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
  routeDoc({
    data: EvalTestCaseSchema,
    description: RESOURCE_DESCRIPTION,
    errors: [404],
    summary: 'Get a test case',
    tags: ['eval'],
  }),
  requireAuth,
  requireRead,
  zValidator('param', EvalResourceIdSchema),
  async (c) => new EvalResourceController().getTestCase(c),
);

app.patch(
  '/test-cases/:id',
  routeDoc({
    data: EvalTestCaseSchema,
    description: RESOURCE_DESCRIPTION,
    errors: [404],
    summary: 'Update a test case',
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
  routeDoc({
    data: DeletedResourceSchema,
    description: RESOURCE_DESCRIPTION,
    errors: [404],
    summary: 'Delete a test case',
    tags: ['eval'],
  }),
  requireAuth,
  requireWrite,
  zValidator('param', EvalResourceIdSchema),
  async (c) => new EvalResourceController().deleteTestCase(c),
);

app.post(
  '/runs/:id/claim',
  routeDoc({
    data: EvalRunSchema,
    description: LIFECYCLE_DESCRIPTION,
    errors: [404, 409],
    summary: 'Claim a pending external eval run',
    tags: ['eval'],
  }),
  requireAuth,
  requireWrite,
  zValidator('param', EvalRunIdParamSchema),
  async (c) => new EvalController().claim(c),
);

app.patch(
  '/runs/:id/status',
  routeDoc({
    data: EvalRunSchema,
    description: LIFECYCLE_DESCRIPTION,
    errors: [404, 409],
    summary: 'Set the status of an external eval run',
    tags: ['eval'],
  }),
  requireAuth,
  requireWrite,
  zValidator('param', EvalRunIdParamSchema),
  zValidator('json', EvalSetStatusSchema),
  async (c) => new EvalController().setStatus(c),
);

app.post(
  '/runs/:id/retry-errors',
  routeDoc({
    data: EvalRetryErrorsSchema,
    description: LIFECYCLE_DESCRIPTION,
    errors: [404, 409],
    summary: 'Retry the errored cases of an eval run',
    tags: ['eval'],
  }),
  requireAuth,
  requireWrite,
  zValidator('param', EvalRunIdParamSchema),
  async (c) => new EvalController().retryErrors(c),
);

app.put(
  '/runs/:runId/topics/:topicId/result',
  routeDoc({
    data: EvalReportResultSchema,
    description: LIFECYCLE_DESCRIPTION,
    errors: [404, 409],
    summary: 'Report the result of one run topic',
    tags: ['eval'],
  }),
  requireAuth,
  requireWrite,
  zValidator('param', EvalRunTopicPathSchema),
  zValidator('json', EvalReportSchema),
  async (c) => new EvalController().report(c),
);

app.post(
  '/runs/:id/results',
  routeDoc({
    data: EvalBatchReportResultSchema,
    description: LIFECYCLE_DESCRIPTION,
    errors: [404, 409],
    summary: 'Report results for a batch of run topics',
    tags: ['eval'],
  }),
  requireAuth,
  requireWrite,
  zValidator('param', EvalRunIdParamSchema),
  zValidator('json', EvalBatchReportSchema),
  async (c) => new EvalController().reportBatch(c),
);

export default app;
