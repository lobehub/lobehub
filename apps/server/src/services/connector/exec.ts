import { ConnectorToolPermission } from '@/database/schemas';
import { mcpService } from '@/server/services/mcp';

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
  params: { args?: string; identifier: string; toolName: string },
  ctx: ConnectorToolSyncContext,
): Promise<unknown> => {
  const [connector] = await ctx.connectorModel.queryByIdentifiers([params.identifier]);
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

  const fresh = await ensureFreshConnectorToken(connector, ctx.connectorModel);

  return mcpService.callTool({
    argsStr: params.args ?? '{}',
    clientParams: buildConnectorMcpParams(fresh),
    toolName: params.toolName,
  });
};
