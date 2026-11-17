import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { EvalContextController } from '../controllers/eval-context.controller';
import { PluginController } from '../controllers/plugin.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission } from '../middleware/permission-check';
import { DeletedResourceSchema } from '../types/common.type';
import { EvalPaginationSchema } from '../types/eval-resource.type';
import {
  InstalledPluginListSchema,
  InstalledPluginSchema,
  InstallPluginRequestSchema,
  PluginIdentifierParamSchema,
  UpdatePluginRequestSchema,
} from '../types/plugin.type';

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

const requireWrite = requireAnyPermission(getAllScopePermissions('AGENT_UPDATE'));

PluginsRoutes.post(
  '/',
  routeDoc({
    data: InstalledPluginSchema,
    description:
      'Installs a plugin from its manifest. Installing an identifier that is already installed replaces its manifest. Remote MCP servers are added with `POST /mcp-servers` instead.',
    errors: [409],
    operationId: 'plugins.install',
    summary: 'Install a plugin',
    tags: ['plugins'],
  }),
  requireAuth,
  requireWrite,
  zValidator('json', InstallPluginRequestSchema),
  async (c) => new PluginController().installPlugin(c),
);

PluginsRoutes.patch(
  '/:identifier',
  routeDoc({
    data: InstalledPluginSchema,
    description:
      'Changes the manifest, settings or custom connection parameters of an installed plugin.',
    errors: [404],
    summary: 'Update an installed plugin',
    tags: ['plugins'],
  }),
  requireAuth,
  requireWrite,
  zValidator('param', PluginIdentifierParamSchema),
  zValidator('json', UpdatePluginRequestSchema),
  async (c) => new PluginController().updatePlugin(c),
);

PluginsRoutes.delete(
  '/:identifier',
  routeDoc({
    data: DeletedResourceSchema,
    errors: [404],
    operationId: 'plugins.uninstall',
    summary: 'Uninstall a plugin',
    tags: ['plugins'],
  }),
  requireAuth,
  requireWrite,
  zValidator('param', PluginIdentifierParamSchema),
  async (c) => new PluginController().uninstallPlugin(c),
);
