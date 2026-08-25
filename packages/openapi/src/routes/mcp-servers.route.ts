import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';

import { getAllScopePermissions } from '@/utils/rbac';

import { zValidator } from '../common/validator';
import { McpServerController } from '../controllers/mcp-server.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermissionWithApiKeyScope } from '../middleware/permission-check';
import {
  CreateMcpServerRequestSchema,
  McpServerIdParamSchema,
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
  describeRoute({ summary: 'List remote MCP servers', tags: ['mcp-servers'] }),
  requireAuth,
  requireRead,
  async (c) => new McpServerController().listServers(c),
);

app.post(
  '/',
  describeRoute({ summary: 'Add a remote MCP server', tags: ['mcp-servers'] }),
  requireAuth,
  requireWrite,
  zValidator('json', CreateMcpServerRequestSchema),
  async (c) => new McpServerController().createServer(c),
);

app.get('/:id', requireAuth, requireRead, zValidator('param', McpServerIdParamSchema), async (c) =>
  new McpServerController().getServer(c),
);

app.patch(
  '/:id',
  requireAuth,
  requireWrite,
  zValidator('param', McpServerIdParamSchema),
  zValidator('json', UpdateMcpServerRequestSchema),
  async (c) => new McpServerController().updateServer(c),
);

app.delete(
  '/:id',
  requireAuth,
  requireWrite,
  zValidator('param', McpServerIdParamSchema),
  async (c) => new McpServerController().deleteServer(c),
);

app.post(
  '/:id/sync',
  describeRoute({ summary: 'Discover and sync MCP tools', tags: ['mcp-servers'] }),
  requireAuth,
  requireWrite,
  zValidator('param', McpServerIdParamSchema),
  async (c) => new McpServerController().syncServer(c),
);

export default app;
