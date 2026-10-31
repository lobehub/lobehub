import type { LobeChatDatabase } from '@lobechat/database';

import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import type { ConnectorToolPermission } from '@/database/schemas';

import { isAgentPluginDisabled } from './agentPluginAccess';
import { canCallNativeConnectorTool, hasNativeConnectorPolicy } from './connectorAccessPolicy';

// Re-exported from a pure module so the same patch logic is usable client-side.
export { patchManifestWithPermissions } from './patchManifestPermissions';

/**
 * Look up the user's permission setting for a specific connector tool.
 *
 * @param db        - Server DB instance
 * @param userId    - Authenticated user ID
 * @param identifier - Connector identifier (e.g. 'gmail', 'vercel')
 * @param toolName  - Tool API name (e.g. 'gmail_search_emails', 'deploy')
 * @param workspaceId - Workspace scope (omit for personal mode)
 * @param agentId - Agent scope: prefer the agent-owned connector row for this
 *   identifier (Agent > Workspace/Personal), matching runtime resolution.
 *
 * Returns the stored permission, or null if no connector/tool entry exists.
 */
export async function getConnectorToolPermission(
  db: LobeChatDatabase,
  userId: string,
  identifier: string,
  toolName: string,
  workspaceId?: string,
  agentId?: string,
): Promise<ConnectorToolPermission | null> {
  try {
    if (agentId && (await isAgentPluginDisabled(db, agentId, identifier))) return 'disabled';
    const connectorModel = new ConnectorModel(db, userId, workspaceId);
    const [connector] = await connectorModel.resolveByIdentifiers([identifier], agentId);
    if (!connector) return null;
    if (!canCallNativeConnectorTool(connector, agentId, toolName)) return 'disabled';

    const toolModel = new ConnectorToolModel(db, userId, workspaceId);
    const tools = await toolModel.queryByConnector(connector.id);
    const tool = tools.find((t) => t.toolName === toolName);
    if (hasNativeConnectorPolicy(connector) && !tool) return 'disabled';
    return (tool?.permission as ConnectorToolPermission) ?? null;
  } catch {
    // A lookup failure cannot establish that this is an unmanaged connection.
    // Continuing here would bypass grants/revocation during a database outage.
    return 'disabled';
  }
}

/** Standardised blocked-tool response returned to the AI. */
export function buildBlockedToolResponse(toolName: string): {
  content: string;
  state: { content: [{ text: string; type: 'text' }]; isError: boolean };
  success: boolean;
} {
  const message =
    `The tool "${toolName}" cannot be executed with the current connection access. ` +
    `Please ask the user to check the account and agent access in Settings > Connectors.`;
  return {
    content: message,
    state: { content: [{ text: message, type: 'text' }], isError: true },
    success: false,
  };
}
