import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { ConnectorController } from '../controllers/connector.controller';
import { requireAuth } from '../middleware/auth';
import {
  requireAnyPermissionWithApiKeyScope,
  requireFullAccessApiKey,
} from '../middleware/permission-check';
import { DeletedResourceSchema } from '../types/common.type';
import {
  AttachConnectorAgentRequestSchema,
  AuthorizeConnectorRequestSchema,
  ConnectorAuthorizationSchema,
  ConnectorIdParamSchema,
  ConnectorListQuerySchema,
  ConnectorListSchema,
  ConnectorSchema,
  ConnectorSyncResultSchema,
  ConnectorToolListSchema,
  ConnectorToolParamSchema,
  ConnectorToolSchema,
  UpdateConnectorToolRequestSchema,
} from '../types/connector.type';

// Connectors are agent capabilities (RBAC `agent:*`). Reading the inventory
// (never credentials) is open to `mcp:read`, like `/mcp-servers`. Every write
// re-routes or replaces third-party credentials, or changes which tool calls
// need a human (tool permissions), so — as the tRPC `connector` namespace,
// which is `blocked` for restricted keys — it needs a full-access key.
const requireRead = requireAnyPermissionWithApiKeyScope(
  getAllScopePermissions('AGENT_READ'),
  'mcp:read',
);
const requireWrite = [
  requireAnyPermissionWithApiKeyScope(getAllScopePermissions('AGENT_UPDATE'), 'mcp:write'),
  requireFullAccessApiKey(),
] as const;

const app = new Hono();

app.get(
  '/',
  routeDoc({
    data: ConnectorListSchema,
    description:
      'Connected services and MCP servers of the current workspace (or personal scope), with their synced tools. Pass `agentId` for the connectors an agent owns or has mounted. Credentials are never returned.',
    errors: [404],
    summary: 'List connectors',
    tags: ['connectors'],
  }),
  requireAuth,
  requireRead,
  zValidator('query', ConnectorListQuerySchema),
  async (c) => new ConnectorController().listConnectors(c),
);

app.get(
  '/:id',
  routeDoc({
    data: ConnectorSchema,
    errors: [404],
    summary: 'Get a connector',
    tags: ['connectors'],
  }),
  requireAuth,
  requireRead,
  zValidator('param', ConnectorIdParamSchema),
  async (c) => new ConnectorController().getConnector(c),
);

app.delete(
  '/:id',
  routeDoc({
    data: DeletedResourceSchema,
    description:
      'Disconnects the service and removes the connector with its tools and stored credentials. An agent that had it pinned stops using it.',
    errors: [404],
    summary: 'Disconnect and remove a connector',
    tags: ['connectors'],
  }),
  requireAuth,
  ...requireWrite,
  zValidator('param', ConnectorIdParamSchema),
  async (c) => new ConnectorController().deleteConnector(c),
);

app.post(
  '/:id/authorize',
  routeDoc({
    data: ConnectorAuthorizationSchema,
    description:
      "Starts an OAuth connection for an HTTP connector: discovers the server's authorization server, registers a client when needed and returns the URL the user opens to grant access. The connector becomes `connected` once the user completes the flow; poll `GET /connectors/{id}`.",
    errors: [404],
    operationId: 'connectors.authorize',
    summary: 'Start an OAuth connection',
    tags: ['connectors'],
  }),
  requireAuth,
  ...requireWrite,
  zValidator('param', ConnectorIdParamSchema),
  zValidator('json', AuthorizeConnectorRequestSchema),
  async (c) => new ConnectorController().authorize(c),
);

app.post(
  '/:id/sync',
  routeDoc({
    data: ConnectorSyncResultSchema,
    description:
      'Fetches the tool list from the service and updates the synced tools. Tool permissions you set are kept.',
    errors: [404, 412],
    operationId: 'connectors.sync',
    summary: 'Sync connector tools',
    tags: ['connectors'],
  }),
  requireAuth,
  ...requireWrite,
  zValidator('param', ConnectorIdParamSchema),
  async (c) => new ConnectorController().syncTools(c),
);

app.put(
  '/:id/agent',
  routeDoc({
    data: ConnectorSchema,
    description:
      'Attaches the connector to an agent the caller can edit, by binding (moving it into the agent) or mounting (reserving a shared connector for the agent).',
    errors: [404, 409],
    operationId: 'connectors.attachAgent',
    summary: 'Attach a connector to an agent',
    tags: ['connectors'],
  }),
  requireAuth,
  ...requireWrite,
  zValidator('param', ConnectorIdParamSchema),
  zValidator('json', AttachConnectorAgentRequestSchema),
  async (c) => new ConnectorController().attachAgent(c),
);

app.delete(
  '/:id/agent',
  routeDoc({
    data: ConnectorSchema,
    description:
      'Returns a bound connector to the workspace / personal scope, or releases a mount. A connector attached to no agent is returned unchanged.',
    errors: [404, 409],
    operationId: 'connectors.detachAgent',
    summary: 'Detach a connector from its agent',
    tags: ['connectors'],
  }),
  requireAuth,
  ...requireWrite,
  zValidator('param', ConnectorIdParamSchema),
  async (c) => new ConnectorController().detachAgent(c),
);

app.get(
  '/:id/tools',
  routeDoc({
    data: ConnectorToolListSchema,
    description:
      'The synced tools with their permission and whether each call needs human approval.',
    errors: [404],
    summary: 'List connector tools and their permissions',
    tags: ['connectors'],
  }),
  requireAuth,
  requireRead,
  zValidator('param', ConnectorIdParamSchema),
  async (c) => new ConnectorController().listTools(c),
);

app.patch(
  '/:id/tools/:toolId',
  routeDoc({
    data: ConnectorToolSchema,
    description:
      'Sets whether the tool runs automatically, needs human approval for every call, or is disabled. Applies to conversations and `POST /tools/call` alike.',
    errors: [404],
    operationId: 'connectors.updateTool',
    summary: 'Set a connector tool permission',
    tags: ['connectors'],
  }),
  requireAuth,
  ...requireWrite,
  zValidator('param', ConnectorToolParamSchema),
  zValidator('json', UpdateConnectorToolRequestSchema),
  async (c) => new ConnectorController().updateTool(c),
);

export default app;
