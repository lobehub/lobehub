import type { ConnectorModel, DecryptedConnector } from '@/database/models/connector';
import type { ConnectorToolModel } from '@/database/models/connectorTool';
import type { ConnectorCredentials } from '@/database/schemas';
import { ConnectorMcpConnectionType, ConnectorStatus } from '@/database/schemas';
import type { AuthConfig } from '@/libs/mcp';
import { inferCrudType } from '@/libs/mcp/utils';
import { mcpService } from '@/server/services/mcp';

import { ensureFreshConnectorToken } from './tokens';

export interface ConnectorToolSyncContext {
  connectorModel: ConnectorModel;
  connectorToolModel: ConnectorToolModel;
}

/** Build the MCP client connection params (with auth) from a connector row. */
export const buildConnectorMcpParams = (
  connector: DecryptedConnector,
): Parameters<typeof mcpService.listRawTools>[0] => {
  if (connector.mcpConnectionType === ConnectorMcpConnectionType.stdio) {
    if (!connector.mcpStdioConfig) throw new Error('Missing stdio config');
    return {
      args: connector.mcpStdioConfig.args ?? [],
      command: connector.mcpStdioConfig.command,
      env: connector.mcpStdioConfig.env,
      name: connector.name,
      type: 'stdio',
    };
  }
  if (!connector.mcpServerUrl) throw new Error('Connector has no MCP server URL configured');
  return {
    auth: buildAuthFromCredentials(connector.credentials),
    name: connector.name,
    type: 'http',
    url: connector.mcpServerUrl,
  };
};

/** Map stored credentials into the MCP client's auth config. */
export const buildAuthFromCredentials = (
  credentials: ConnectorCredentials | null,
): AuthConfig | undefined => {
  if (!credentials) return undefined;

  switch (credentials.type) {
    case 'oauth2': {
      return {
        accessToken: credentials.accessToken,
        clientId: undefined,
        clientSecret: credentials.clientSecret,
        refreshToken: credentials.refreshToken,
        tokenExpiresAt: credentials.expiresAt,
        type: 'oauth2',
      };
    }
    case 'bearer': {
      return { token: credentials.token, type: 'bearer' };
    }
    default: {
      return undefined;
    }
  }
};

/**
 * Connect to a connector's MCP server, fetch its tool list, and sync it into
 * `user_connector_tools`. Refreshes the OAuth token first when needed, and
 * updates the connector status (`connected` on success, `error` on failure).
 *
 * Shared by the `syncTools` tRPC mutation and the OAuth callback so a connector
 * has its tools immediately after authorization — no client round-trip needed.
 */
export const syncConnectorToolsById = async (
  connectorId: string,
  ctx: ConnectorToolSyncContext,
): Promise<{ toolCount: number }> => {
  let connector = await ctx.connectorModel.findById(connectorId);
  if (!connector) throw new Error('Connector not found');

  if (!connector.mcpServerUrl && connector.mcpConnectionType !== ConnectorMcpConnectionType.stdio) {
    throw new Error('Connector has no MCP server URL configured');
  }

  // Refresh the OAuth access token if it has expired before connecting.
  connector = await ensureFreshConnectorToken(connector, ctx.connectorModel);

  const mcpParams = buildConnectorMcpParams(connector);

  let rawTools: Awaited<ReturnType<typeof mcpService.listRawTools>>;
  try {
    rawTools = await mcpService.listRawTools(mcpParams);
  } catch (err) {
    await ctx.connectorModel.updateStatus(connectorId, ConnectorStatus.error);
    throw err;
  }

  const syncInputs = rawTools.map((t) => ({
    crudType: inferCrudType(t.name),
    description: t.description,
    inputSchema: t.inputSchema as Record<string, unknown>,
    toolName: t.name,
  }));

  await ctx.connectorToolModel.upsertMany(connectorId, syncInputs);
  await ctx.connectorModel.updateStatus(connectorId, ConnectorStatus.connected);

  return { toolCount: syncInputs.length };
};
