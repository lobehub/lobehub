import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { ToolCallController } from '../controllers/tool-call.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermissionWithApiKeyScope } from '../middleware/permission-check';
import { ToolCallRequestSchema, ToolCallResultSchema } from '../types/tool-call.type';

const app = new Hono();

app.post(
  '/call',
  routeDoc({
    data: ToolCallResultSchema,
    description: [
      "Calls one tool of an installed connector / MCP server as the API key's user, with the credentials stored on the connector.",
      'The same rules as in a conversation apply: the connector must be enabled and the tool synced and not `disabled`.',
      'A tool that needs human approval (`requiresApproval` on the connector tool) is refused with `403 approval_required`: an API call cannot be approved. Only the user (in the app, or with a full-access key) can change a tool permission.',
      'A tool that ran but reported a failure answers 200 with `success: false`.',
    ].join('\n\n'),
    errors: [404, 412, 502, 503],
    operationId: 'tools.call',
    summary: 'Call a connector tool',
    tags: ['tools'],
  }),
  requireAuth,
  // Calling a tool acts with the connector's stored credentials: the issuer
  // must be able to use agent capabilities (members and owners, not viewers),
  // and a restricted key needs its own `tool:invoke` tier. This deliberately
  // opens `connector.callTool` (whose tRPC namespace is `blocked` for
  // restricted keys) to that one scope; the approval gate still applies.
  requireAnyPermissionWithApiKeyScope(getAllScopePermissions('AGENT_UPDATE'), 'tool:invoke'),
  zValidator('json', ToolCallRequestSchema),
  async (c) => new ToolCallController().callTool(c),
);

export default app;
