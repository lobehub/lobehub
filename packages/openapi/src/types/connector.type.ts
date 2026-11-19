import { z } from 'zod';

import { CursorPaginationQuerySchema, paginatedListSchema } from '../helpers/pagination';
import { dateTimeSchema, jsonObjectSchema } from './common.type';
import { MCP_SERVER_STATUSES, MCP_TOOL_PERMISSIONS } from './mcp-server.type';

// ==================== Shared ====================

export const ConnectorToolPermissionSchema = z
  .enum(MCP_TOOL_PERMISSIONS)
  .describe(
    '`auto` runs without confirmation, `needs_approval` asks a human before every call (and is refused by `POST /tools/call`), `disabled` never runs.',
  )
  .meta({ id: 'ConnectorToolPermission' });

// ==================== Response Schemas ====================

export const ConnectorToolSchema = z
  .object({
    description: z.string().nullable(),
    id: z.string(),
    inputSchema: jsonObjectSchema.nullable().describe('JSON Schema of the tool arguments.'),
    name: z.string().describe('Tool name, as `toolName` in `POST /tools/call`.'),
    permission: ConnectorToolPermissionSchema,
    requiresApproval: z
      .boolean()
      .describe(
        'Whether a human must approve each call: `permission` is `needs_approval`, or the server marks the tool for mandatory approval.',
      ),
  })
  .strict()
  .meta({ id: 'ConnectorTool' });

export const ConnectorSchema = z
  .object({
    agentId: z
      .string()
      .nullable()
      .describe('The agent that owns this connector; `null` for a workspace / personal one.'),
    avatar: z.string().nullable(),
    connectionType: z.enum(['http', 'stdio']).nullable(),
    createdAt: dateTimeSchema,
    description: z.string().nullable(),
    hasCredentials: z.boolean().describe('Whether credentials (OAuth tokens, a key) are stored.'),
    id: z.string(),
    identifier: z.string().describe('Stable identifier, as `identifier` in `POST /tools/call`.'),
    isEnabled: z.boolean(),
    mountedByAgentId: z
      .string()
      .nullable()
      .describe('The agent this workspace / personal connector is mounted on, if any.'),
    name: z.string(),
    serverUrl: z.string().nullable().describe('Remote MCP endpoint, for HTTP connectors.'),
    sourceType: z
      .enum(['builtin', 'custom', 'marketplace'])
      .describe(
        '`custom` for an MCP server you added, `marketplace` for an installed integration, `builtin` for a LobeHub tool.',
      ),
    status: z.enum(MCP_SERVER_STATUSES),
    tools: z.array(ConnectorToolSchema),
    updatedAt: dateTimeSchema,
  })
  .strict()
  .meta({ id: 'Connector' });

export const ConnectorToolListSchema = z.object({ items: z.array(ConnectorToolSchema) }).strict();

export const ConnectorListSchema = paginatedListSchema(ConnectorSchema, { total: true });

export const ConnectorAuthorizationSchema = z
  .object({
    authorizationUrl: z
      .string()
      .describe('Open in a browser for the user to sign in to the service and grant access.'),
    flowId: z.string().describe('Identifies this authorization attempt.'),
  })
  .strict()
  .meta({ id: 'ConnectorAuthorization' });

export const ConnectorSyncResultSchema = z
  .object({ id: z.string(), toolCount: z.number().int().min(0) })
  .strict()
  .meta({ id: 'ConnectorSyncResult' });

// ==================== Request Schemas ====================

export const ConnectorIdParamSchema = z.object({ id: z.uuid() });

export const ConnectorToolParamSchema = z.object({ id: z.uuid(), toolId: z.uuid() });

export const ConnectorListQuerySchema = z.object({
  ...CursorPaginationQuerySchema.shape,
  agentId: z
    .string()
    .min(1)
    .optional()
    .describe(
      "List the agent's connectors (owned by or mounted on it) instead of the workspace / personal ones.",
    ),
});

export const AuthorizeConnectorRequestSchema = z
  .object({
    returnTo: z
      .string()
      .max(2048)
      .optional()
      .describe('In-app path the browser returns to after authorization.'),
  })
  .strict();

export const AttachConnectorAgentRequestSchema = z
  .object({
    agentId: z.string().min(1),
    mode: z
      .enum(['bind', 'mount'])
      .default('bind')
      .describe(
        '`bind` moves the connector into the agent (only that agent uses it); `mount` keeps it shared but reserves it for the agent.',
      ),
  })
  .strict();

export const UpdateConnectorToolRequestSchema = z
  .object({ permission: ConnectorToolPermissionSchema })
  .strict();

export type AttachConnectorAgentRequest = z.infer<typeof AttachConnectorAgentRequestSchema>;
export type AuthorizeConnectorRequest = z.infer<typeof AuthorizeConnectorRequestSchema>;
export type ConnectorListQuery = z.infer<typeof ConnectorListQuerySchema>;
export type ConnectorResponse = z.infer<typeof ConnectorSchema>;
export type ConnectorToolResponse = z.infer<typeof ConnectorToolSchema>;
export type UpdateConnectorToolRequest = z.infer<typeof UpdateConnectorToolRequestSchema>;
