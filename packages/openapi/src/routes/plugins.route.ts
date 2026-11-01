import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';

import { getAllScopePermissions } from '@/utils/rbac';

import { zValidator } from '../common/validator';
import { EvalContextController } from '../controllers/eval-context.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission } from '../middleware/permission-check';
import { EvalPaginationSchema } from '../types/eval-resource.type';

export const PluginsRoutes = new Hono();
PluginsRoutes.get(
  '/',
  describeRoute({
    summary: 'List installed plugins in the current workspace or personal scope',
    tags: ['plugins'],
  }),
  requireAuth,
  requireAnyPermission(getAllScopePermissions('AGENT_READ')),
  zValidator('query', EvalPaginationSchema),
  async (c) => new EvalContextController().listPlugins(c),
);
