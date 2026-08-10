import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';

import { getAllScopePermissions } from '@/utils/rbac';

import { zValidator } from '../common/validator';
import { EvalController } from '../controllers/eval.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission, requireApiKeyScope } from '../middleware/permission-check';
import { CreateEvalRunRequestSchema, EvalRunIdParamSchema } from '../types/eval.type';

const app = new Hono();
const requireRead = requireAnyPermission(getAllScopePermissions('AGENT_READ'));
const requireWrite = requireAnyPermission(getAllScopePermissions('AGENT_UPDATE'));

app.post(
  '/runs',
  describeRoute({
    description: 'Queues an asynchronous QStash-backed evaluation run and returns immediately.',
    summary: 'Create an eval run',
    tags: ['eval'],
  }),
  requireAuth,
  requireWrite,
  requireApiKeyScope('model:invoke'),
  zValidator('json', CreateEvalRunRequestSchema),
  async (c) => new EvalController().createRun(c),
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
  async (c) => new EvalController().getRunResults(c),
);

export default app;
