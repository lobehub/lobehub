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
  McpServerLiveToolListSchema,
  McpServerPromptListSchema,
  McpServerResourceListSchema,
  McpServerSchema,
  McpServerSyncResultSchema,
  UpdateMcpServerRequestSchema,
} from '../types/mcp-server.type';
import { McpServerToolCallRequestSchema, ToolCallResultSchema } from '../types/tool-call.type';

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

const LIVE_DESCRIPTION =
  'Asks the MCP server now, with its stored credentials. Answers 502 when the server fails, 503 when it cannot be reached.';

app.get(
  '/:id/tools',
  routeDoc({
    data: McpServerLiveToolListSchema,
    description: `${LIVE_DESCRIPTION} The synced tools an agent uses (and their permissions) are on the server object; \`POST /mcp-servers/{id}/sync\` refreshes them.`,
    errors: [404, 502, 503],
    summary: 'List the tools an MCP server offers',
    tags: ['mcp-servers'],
  }),
  requireAuth,
  requireRead,
  zValidator('param', McpServerIdParamSchema),
  async (c) => new McpServerController().listLiveTools(c),
);

app.post(
  '/:id/tools/call',
  routeDoc({
    data: ToolCallResultSchema,
    description:
      "Calls one synced tool of this server as the API key's user — `POST /tools/call` addressed by server id, with the same rules: a `disabled` tool is refused and a tool that needs human approval answers `403 approval_required` instead of running.",
    errors: [404, 412, 502, 503],
    operationId: 'mcpServers.callTool',
    summary: 'Call an MCP server tool',
    tags: ['mcp-servers'],
  }),
  requireAuth,
  requireAnyPermissionWithApiKeyScope(getAllScopePermissions('AGENT_UPDATE'), 'tool:invoke'),
  zValidator('param', McpServerIdParamSchema),
  zValidator('json', McpServerToolCallRequestSchema),
  async (c) => new McpServerController().callTool(c),
);

app.get(
  '/:id/resources',
  routeDoc({
    data: McpServerResourceListSchema,
    description: LIVE_DESCRIPTION,
    errors: [404, 502, 503],
    summary: 'List the resources an MCP server offers',
    tags: ['mcp-servers'],
  }),
  requireAuth,
  requireRead,
  zValidator('param', McpServerIdParamSchema),
  async (c) => new McpServerController().listResources(c),
);

app.get(
  '/:id/prompts',
  routeDoc({
    data: McpServerPromptListSchema,
    description: LIVE_DESCRIPTION,
    errors: [404, 502, 503],
    summary: 'List the prompts an MCP server offers',
    tags: ['mcp-servers'],
  }),
  requireAuth,
  requireRead,
  zValidator('param', McpServerIdParamSchema),
  async (c) => new McpServerController().listPrompts(c),
);

export default app;
