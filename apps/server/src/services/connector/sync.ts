import { buildMcpToolMetadata, getMcpToolVisibility } from '@lobechat/const/mcpApp';

import type { ConnectorModel, DecryptedConnector } from '@/database/models/connector';
import type { ConnectorToolModel } from '@/database/models/connectorTool';
import type { ConnectorCredentials } from '@/database/schemas';
import { ConnectorMcpConnectionType, ConnectorStatus } from '@/database/schemas';
import type { AuthConfig } from '@/libs/mcp';
import { inferCrudType } from '@/libs/mcp/utils';
import { mcpService } from '@/server/services/mcp';
import { isMcpAppsEnabled } from '@/server/services/mcp/featureGate';

import { ensureFreshConnectorToken } from './tokens';

export interface ConnectorToolSyncContext {
  connectorModel: ConnectorModel;
  connectorToolModel: ConnectorToolModel;
}

/**
 * Build the MCP client connection params (with auth) from a connector row.
 *
 * Must match the params agent runs use (`buildConnectorManifests`): the MCP
 * client session is cached by these params, so a view's resource read and
 * tool calls only reach the session its tool ran on when they are equal.
 * `name` is therefore the stable identifier, not the editable display name.
 */
export const buildConnectorMcpParams = (
  connector: DecryptedConnector,
): Parameters<typeof mcpService.listRawTools>[0] => {
  if (connector.mcpConnectionType === ConnectorMcpConnectionType.stdio) {
    if (!connector.mcpStdioConfig) throw new Error('Missing stdio config');
    return {
      args: connector.mcpStdioConfig.args ?? [],
      command: connector.mcpStdioConfig.command,
      env: connector.mcpStdioConfig.env,
      name: connector.identifier,
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
    name: connector.identifier,
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
      // Only the access token: callers refresh it first (ensureFreshConnectorToken),
      // and the MCP client sends nothing else. Refresh metadata here would also
      // make these params, and so the cached MCP session, differ from the agent
      // runtime's for the same connector.
      return { auth: { accessToken: credentials.accessToken, type: 'oauth2' } };
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
 * Connect to a connector's MCP server, fetch its tool list, and sync it into
 * `user_connector_tools`. Refreshes the OAuth token first when needed, and
 * updates the connector status (`connected` on success, `error` on failure).
 *
 * Shared by the `syncTools` tRPC mutation and the OAuth callback so a connector
 * has its tools immediately after authorization — no client round-trip needed.
 */
export const syncConnectorToolsById = async (
  connectorId: string,
  /** `userId` decides the `mcp_apps` flag: with it on, view-only tools are listed too. */
  ctx: ConnectorToolSyncContext & { userId?: string | null },
  options: { pruneMissingAutoTools?: boolean } = {},
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
    // A server may list the tools only its views call just to a client
    // announcing MCP Apps; they are synced, and kept from the model, all the same
    rawTools = await mcpService.listRawTools(mcpParams, {
      mcpApps: await isMcpAppsEnabled(ctx.userId),
    });
  } catch (err) {
    await ctx.connectorModel.updateStatus(connectorId, ConnectorStatus.error);
    throw err;
  }

  const syncInputs = rawTools.map((t) => ({
    crudType: inferCrudType(t.name),
    description: t.description,
    inputSchema: t.inputSchema as Record<string, unknown>,
    // Kept even for view-only tools: a view's call must find the tool synced,
    // while the manifest build leaves it out of the model's tool list.
    metadata: buildMcpToolMetadata(getMcpToolVisibility(t._meta)),
    toolName: t.name,
  }));

  await ctx.connectorToolModel.upsertMany(connectorId, syncInputs);
  if (options.pruneMissingAutoTools) {
    // Eval contracts exclude vanished auto tools. Retain denied/approval rows as
    // permission tombstones so a later upstream listing cannot auto-approve them.
    const restricted = (await ctx.connectorToolModel.queryByConnector(connectorId))
      .filter((tool) => tool.permission !== 'auto')
      .map((tool) => tool.toolName);
    await ctx.connectorToolModel.deleteToolsNotIn(connectorId, [
      ...syncInputs.map((tool) => tool.toolName),
      ...restricted,
    ]);
  }
  await ctx.connectorModel.updateStatus(connectorId, ConnectorStatus.connected);

  return { toolCount: syncInputs.length };
};
