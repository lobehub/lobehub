import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { EvalContextController } from '../controllers/eval-context.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission } from '../middleware/permission-check';
import { EvalPaginationSchema } from '../types/eval-resource.type';
import { InstalledPluginListSchema } from '../types/plugin.type';

export const PluginsRoutes = new Hono();
PluginsRoutes.get(
  '/',
  routeDoc({
    data: InstalledPluginListSchema,
    summary: 'List installed plugins in the current workspace or personal scope',
    tags: ['plugins'],
  }),
  requireAuth,
  requireAnyPermission(getAllScopePermissions('AGENT_READ')),
  zValidator('query', EvalPaginationSchema),
  async (c) => new EvalContextController().listPlugins(c),
);
