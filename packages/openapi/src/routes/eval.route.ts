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
  // An internal run pre-creates real chat topics through `TopicModel`, and the
  // QStash workflow keeps writing topic/message state, so a restricted key needs
  // the same `chat:write` gate as `/responses` and the tRPC agent-run entries.
  requireApiKeyScope('chat:write'),
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
