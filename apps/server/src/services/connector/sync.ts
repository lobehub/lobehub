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

export interface ClientConnectorTool {
  description?: string;
  inputSchema?: Record<string, unknown>;
  toolName: string;
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
  const { auth, headers } = buildHttpAuthFromCredentials(connector.credentials);
  // Custom headers live in `metadata.customHeaders` (plaintext, independent of
  // the single-kind `credentials` column) so they can coexist with any auth
  // type. Merge them on top of any header-type credential headers (older rows
  // stored custom headers as a 'header' credential before this split).
  const customHeaders = connector.metadata?.customHeaders as Record<string, string> | undefined;
  const mergedHeaders = headers || customHeaders ? { ...headers, ...customHeaders } : undefined;
  return {
    auth,
    headers: mergedHeaders,
    name: connector.name,
    type: 'http',
    url: connector.mcpServerUrl,
  };
};

/**
 * Map stored credentials into the HTTP MCP client's auth config + custom headers.
 *
 * The MCP client only understands `bearer`/`oauth2` auth (both become an
 * `Authorization: Bearer …` header), so:
 * - bearer / apikey → bearer auth
 * - header          → passed through verbatim as request headers
 */
export const buildHttpAuthFromCredentials = (
  credentials: ConnectorCredentials | null,
): { auth?: AuthConfig; headers?: Record<string, string> } => {
  if (!credentials) return {};

  switch (credentials.type) {
    case 'oauth2': {
      return {
        auth: {
          accessToken: credentials.accessToken,
          clientId: undefined,
          clientSecret: credentials.clientSecret,
          refreshToken: credentials.refreshToken,
          tokenExpiresAt: credentials.expiresAt,
          type: 'oauth2',
        },
      };
    }
    case 'bearer': {
      return { auth: { token: credentials.token, type: 'bearer' } };
    }
    case 'apikey': {
      return { auth: { token: credentials.apiKey, type: 'bearer' } };
    }
    case 'header': {
      return { headers: credentials.headers };
    }
    default: {
      return {};
    }
  }
};

/**
 * Sync a connector's tools into `user_connector_tools`. A supplied list is
 * accepted only for stdio connectors; otherwise tools are fetched from the MCP
 * server after refreshing OAuth when needed. Updates status to `connected` on
 * successful persistence and keeps the existing remote-fetch error handling.
 *
 * Shared by the `syncTools` tRPC mutation and the OAuth callback so a connector
 * has its tools immediately after authorization — no client round-trip needed.
 */
export const syncConnectorToolsById = async (
  connectorId: string,
  ctx: ConnectorToolSyncContext,
  clientTools?: ClientConnectorTool[],
): Promise<{ toolCount: number }> => {
  let connector = await ctx.connectorModel.findById(connectorId);
  if (!connector) throw new Error('Connector not found');

  let toolsToSync: ClientConnectorTool[];

  if (clientTools !== undefined) {
    if (connector.mcpConnectionType !== ConnectorMcpConnectionType.stdio) {
      throw new Error('Client-supplied tools are only supported for stdio connectors');
    }
    if (!connector.mcpStdioConfig?.command?.trim()) {
      throw new Error('Connector has no valid STDIO configuration');
    }
    toolsToSync = clientTools;
  } else {
    if (
      !connector.mcpServerUrl &&
      connector.mcpConnectionType !== ConnectorMcpConnectionType.stdio
    ) {
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

    toolsToSync = rawTools.map((tool) => ({
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown>,
      toolName: tool.name,
    }));
  }

  const syncInputs = toolsToSync.map((tool) => ({
    crudType: inferCrudType(tool.toolName),
    description: tool.description,
    inputSchema: tool.inputSchema,
    toolName: tool.toolName,
  }));

  await ctx.connectorToolModel.upsertMany(connectorId, syncInputs);
  await ctx.connectorModel.updateStatus(connectorId, ConnectorStatus.connected);

  return { toolCount: syncInputs.length };
};
