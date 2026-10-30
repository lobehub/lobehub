import { isLocalOrPrivateUrl } from '@lobechat/utils';

import { ConnectorMcpConnectionType, ConnectorToolPermission } from '@/database/schemas';
import { deviceGateway } from '@/server/services/deviceGateway';
import { mcpService } from '@/server/services/mcp';
import { isMcpAppEnabled } from '@/server/services/mcp/featureGate';

import { buildLastSyncedAtMap, scheduleStaleConnectorToolsRefresh } from './refresh';
import { buildConnectorMcpParams, type ConnectorToolSyncContext } from './sync';
import { ensureFreshConnectorToken } from './tokens';

export type ConnectorToolCallErrorCode = 'NOT_FOUND' | 'FORBIDDEN' | 'BAD_REQUEST';

/** Typed error so the tRPC layer can map to the right code and tests can assert. */
export class ConnectorToolCallError extends Error {
  readonly code: ConnectorToolCallErrorCode;

  constructor(code: ConnectorToolCallErrorCode, message: string) {
    super(message);
    this.name = 'ConnectorToolCallError';
    this.code = code;
  }
}

/**
 * The connector an identifier names. With an agent, resolve the way that agent's
 * runs do (agent-owned > mounted > free base row); without one, keep the base
 * lookup the classic chat path has always used.
 */
const findConnector = (
  params: { agentId?: string; identifier: string },
  ctx: ConnectorToolSyncContext,
) =>
  params.agentId
    ? ctx.connectorModel.resolveByIdentifiers([params.identifier], params.agentId)
    : ctx.connectorModel.queryByIdentifiers([params.identifier]);

/**
 * Execute a single connector tool, enforcing the full permission model:
 * - the connector must exist and be enabled,
 * - the tool must exist in the synced tool list (no calling unsynced / forged
 *   tool names — they would otherwise be forwarded blindly to the remote MCP),
 * - the tool must not be disabled.
 *
 * Refreshes the OAuth token first, then calls the remote MCP with the decrypted
 * credentials. Shared by the `connector.callTool` tRPC procedure.
 */
export const callConnectorToolById = async (
  params: { agentId?: string; args?: string; identifier: string; toolName: string },
  /** `userId` decides the caller's `mcp_app` flag: whether the result may carry an MCP App view. */
  ctx: ConnectorToolSyncContext & { userId?: string | null },
): Promise<unknown> => {
  const [connector] = await findConnector(params, ctx);
  if (!connector) {
    throw new ConnectorToolCallError('NOT_FOUND', 'Connector not found');
  }
  if (!connector.isEnabled) {
    throw new ConnectorToolCallError('FORBIDDEN', 'Connector is disabled');
  }

  // The tool MUST be present in the synced list — this is the single source of
  // truth for what is callable. Unknown names (unsynced or hand-crafted) are
  // rejected before reaching the remote server.
  const tools = await ctx.connectorToolModel.queryByConnector(connector.id);
  const tool = tools.find((t) => t.toolName === params.toolName);
  if (!tool) {
    throw new ConnectorToolCallError(
      'BAD_REQUEST',
      `Tool '${params.toolName}' is not available on this connector`,
    );
  }
  if (tool.permission === ConnectorToolPermission.disabled) {
    throw new ConnectorToolCallError(
      'FORBIDDEN',
      `Tool '${params.toolName}' is disabled for this connector`,
    );
  }

  // Keep the tool list fresh through normal use: if it hasn't been synced in a
  // while, refresh it from the upstream MCP server in the background so the user
  // never has to open the connector page and click Refresh by hand. HTTP-only,
  // throttled, and deferred — reuses the `tools` rows already loaded above.
  // Wrapped defensively: this is a pure optimization and must never break the
  // tool call, even if the scheduler itself throws.
  try {
    scheduleStaleConnectorToolsRefresh(
      [
        {
          id: connector.id,
          mcpConnectionType: connector.mcpConnectionType,
          mcpServerUrl: connector.mcpServerUrl,
        },
      ],
      buildLastSyncedAtMap(tools),
      ctx,
    );
  } catch {
    // Background tool-list refresh is best-effort — never fail the tool call.
  }

  // Stdio runs on a desktop device, never in the server process. Private HTTP
  // endpoints also require a device when a gateway is configured; self-hosted
  // servers without a gateway can still connect to their own LAN over HTTP.
  const requiresDevice =
    connector.mcpConnectionType === ConnectorMcpConnectionType.stdio ||
    (deviceGateway.isConfigured &&
      !!connector.mcpServerUrl &&
      isLocalOrPrivateUrl(connector.mcpServerUrl));
  if (requiresDevice) {
    throw new ConnectorToolCallError(
      'BAD_REQUEST',
      `Connector '${connector.name}' points at an MCP endpoint that only your machine can reach (stdio or local network). ` +
        'Run these tools in the desktop app through a configured device gateway.',
    );
  }

  const fresh = await ensureFreshConnectorToken(connector, ctx.connectorModel);

  return mcpService.callTool({
    argsStr: params.args ?? '{}',
    clientParams: buildConnectorMcpParams(fresh),
    mcpApp: await isMcpAppEnabled(ctx.userId),
    toolName: params.toolName,
  });
};

/**
 * Read an MCP Apps `ui://` resource from a connector's server, so the chat can
 * render a connector tool result's interactive view. Same connector checks as
 * {@link callConnectorToolById}, minus the per-tool ones. Refused while the
 * `mcp_app` flag is off, since the read opens a session that advertises MCP Apps.
 */
export const readConnectorUiResourceById = async (
  params: { agentId?: string; identifier: string; uri: string },
  /** `userId` decides the caller's `mcp_app` flag: whether views may be read at all. */
  ctx: ConnectorToolSyncContext & { userId?: string | null },
) => {
  if (!(await isMcpAppEnabled(ctx.userId))) {
    throw new ConnectorToolCallError('FORBIDDEN', 'Interactive views are turned off');
  }

  const [connector] = await findConnector(params, ctx);
  if (!connector) {
    throw new ConnectorToolCallError('NOT_FOUND', 'Connector not found');
  }
  if (!connector.isEnabled) {
    throw new ConnectorToolCallError('FORBIDDEN', 'Connector is disabled');
  }
  if (connector.mcpConnectionType === ConnectorMcpConnectionType.stdio) {
    throw new ConnectorToolCallError(
      'BAD_REQUEST',
      'Interactive views are not supported for stdio connectors yet',
    );
  }
  // A cloud server can't reach a localhost / LAN endpoint, and resource reads
  // aren't tunneled to the device yet; the chat falls back to the plain result.
  if (
    deviceGateway.isConfigured &&
    !!connector.mcpServerUrl &&
    isLocalOrPrivateUrl(connector.mcpServerUrl)
  ) {
    throw new ConnectorToolCallError(
      'BAD_REQUEST',
      'Interactive views are not supported for local-network connectors yet',
    );
  }

  const fresh = await ensureFreshConnectorToken(connector, ctx.connectorModel);

  return mcpService.readUiResource(buildConnectorMcpParams(fresh), params.uri);
};
