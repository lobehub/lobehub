import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { McpServerController } from '../controllers/mcp-server.controller';
import {
  LEGACY_ARRAY_LIST_DESCRIPTION,
  LegacyArrayListQuerySchema,
} from '../helpers/legacy-array-list';
import { paginatedListSchema } from '../helpers/pagination';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermissionWithApiKeyScope } from '../middleware/permission-check';
import { DeletedResourceSchema } from '../types/common.type';
import {
  CreateMcpServerRequestSchema,
  McpServerIdParamSchema,
  McpServerSchema,
  McpServerSyncResultSchema,
  UpdateMcpServerRequestSchema,
} from '../types/mcp-server.type';

const app = new Hono();
const requireRead = requireAnyPermissionWithApiKeyScope(
  getAllScopePermissions('AGENT_READ'),
  'mcp:read',
);
const requireWrite = requireAnyPermissionWithApiKeyScope(
  getAllScopePermissions('AGENT_UPDATE'),
  'mcp:write',
);

app.get(
  '/',
  routeDoc({
    data: paginatedListSchema(McpServerSchema, { total: true }),
    description: LEGACY_ARRAY_LIST_DESCRIPTION,
    summary: 'List remote MCP servers',
    tags: ['mcp-servers'],
  }),
  requireAuth,
  requireRead,
  zValidator('query', LegacyArrayListQuerySchema),
  async (c) => new McpServerController().listServers(c),
);

app.post(
  '/',
  routeDoc({
    data: McpServerSchema,
    errors: [409],
    status: 201,
    summary: 'Add a remote MCP server',
    tags: ['mcp-servers'],
  }),
  requireAuth,
  requireWrite,
  zValidator('json', CreateMcpServerRequestSchema),
  async (c) => new McpServerController().createServer(c),
);

app.get(
  '/:id',
  routeDoc({
    data: McpServerSchema,
    errors: [404],
    summary: 'Get a remote MCP server',
    tags: ['mcp-servers'],
  }),
  requireAuth,
  requireRead,
  zValidator('param', McpServerIdParamSchema),
  async (c) => new McpServerController().getServer(c),
);

app.patch(
  '/:id',
  routeDoc({
    data: McpServerSchema,
    description: 'Changing `serverUrl` or `credentials` resets the status to `disconnected`.',
    errors: [404],
    summary: 'Update a remote MCP server',
    tags: ['mcp-servers'],
  }),
  requireAuth,
  requireWrite,
  zValidator('param', McpServerIdParamSchema),
  zValidator('json', UpdateMcpServerRequestSchema),
  async (c) => new McpServerController().updateServer(c),
);

app.delete(
  '/:id',
  routeDoc({
    data: DeletedResourceSchema,
    errors: [404],
    summary: 'Delete a remote MCP server',
    tags: ['mcp-servers'],
  }),
  requireAuth,
  requireWrite,
  zValidator('param', McpServerIdParamSchema),
  async (c) => new McpServerController().deleteServer(c),
);

app.post(
  '/:id/sync',
  routeDoc({
    data: McpServerSyncResultSchema,
    errors: [404],
    summary: 'Discover and sync MCP tools',
    tags: ['mcp-servers'],
  }),
  requireAuth,
  requireWrite,
  zValidator('param', McpServerIdParamSchema),
  async (c) => new McpServerController().syncServer(c),
);

export default app;
