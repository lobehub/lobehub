import { withMandatoryApprovalMark } from '@lobechat/const';
import { buildMcpToolMetadata } from '@lobechat/const/mcpApp';

import { inferCrudType } from '@/libs/mcp/utils';
import { isMcpAppsEnabled } from '@/server/services/mcp/featureGate';

import { resolveConnectorToolPermission } from './connectorToolPermission';

/** A tool as the client that listed it reports it (`connector.syncToolsFromClient`). */
export interface ClientListedTool {
  description?: string;
  humanIntervention?: unknown;
  inputSchema?: Record<string, unknown>;
  /** The tool's MCP Apps metadata as the client resolved it (`buildMcpToolMetadata`). */
  mcpAppMeta?: Record<string, unknown>;
  toolName: string;
  /** The MCP tool's `_meta.ui.visibility`, when it declares one. */
  visibility?: string[];
}

/**
 * The tool rows a client's listing syncs. The client's MCP Apps metadata is
 * kept only while the caller's `mcp_apps` flag is on; otherwise a row keeps
 * the visibility alone, as before MCP Apps.
 */
export const toClientToolSyncInputs = async (
  tools: ClientListedTool[],
  userId: string | null | undefined,
) => {
  const mcpApps = await isMcpAppsEnabled(userId);

  return tools.map((t) => ({
    crudType: inferCrudType(t.toolName),
    // Applies to new tools only: a synced tool keeps the permission it has
    defaultPermission: resolveConnectorToolPermission(t.humanIntervention),
    description: t.description,
    inputSchema: t.inputSchema,
    // Refreshed on every sync, unlike the permission: an `always` the
    // manifest asks for stays mandatory whatever the permission is
    metadata: withMandatoryApprovalMark(
      mcpApps && t.mcpAppMeta ? t.mcpAppMeta : buildMcpToolMetadata(t.visibility),
      t.humanIntervention,
    ),
    toolName: t.toolName,
  }));
};
