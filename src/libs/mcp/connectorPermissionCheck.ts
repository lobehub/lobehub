import { hasCallableMcpEndpoint } from '@lobechat/const';
import type { LobeChatDatabase } from '@lobechat/database';
import { connectorIdentifierCandidates } from '@lobechat/types';

import { ConnectorModel, type ConnectorRunTarget } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import type { ConnectorToolPermission } from '@/database/schemas';

// Re-exported from a pure module so the same patch logic is usable client-side.
export { patchManifestWithPermissions } from './patchManifestPermissions';

/**
 * Look up the user's permission setting for a specific connector tool.
 *
 * @param db        - Server DB instance
 * @param userId    - Authenticated user ID
 * @param identifier - The tool's identifier: an MCP connector row's tool prefix
 *   (`connectorToolIdentifier`, e.g. 'vercel' or a private row's
 *   'vercel-3f9a1c2e'), or a connector identifier (e.g. 'gmail')
 * @param toolName  - Tool API name (e.g. 'gmail_search_emails', 'deploy')
 * @param workspaceId - Workspace scope (omit for personal mode)
 * @param target - The run's agent and topic, so the gate resolves the same
 *   row the run's manifests were built from (agent-owned rows, and a private
 *   agent's own private connectors in its own topic).
 *
 * Returns the stored permission, or null if no connector/tool entry exists.
 */
export async function getConnectorToolPermission(
  db: LobeChatDatabase,
  userId: string,
  identifier: string,
  toolName: string,
  workspaceId?: string,
  target: ConnectorRunTarget = {},
): Promise<ConnectorToolPermission | null> {
  try {
    const connectorModel = new ConnectorModel(db, userId, workspaceId);
    // An MCP connector's tool runs on the row its prefix names; every other
    // tool (Composio, LobeHub skills, plugins) on the identifier's top row
    const toolSet = (
      await connectorModel.resolveToolSets(target, connectorIdentifierCandidates(identifier))
    ).find((row) => row.toolIdentifier === identifier && hasCallableMcpEndpoint(row));
    const connector =
      toolSet ?? (await connectorModel.resolveByIdentifiers([identifier], target))[0];
    if (!connector) return null;

    const toolModel = new ConnectorToolModel(db, userId, workspaceId, { agentRun: true });
    const tools = await toolModel.queryByConnector(connector.id);
    return (
      (tools.find((t) => t.toolName === toolName)?.permission as ConnectorToolPermission) ?? null
    );
  } catch {
    return null; // never block execution due to DB error
  }
}

/** Standardised blocked-tool response returned to the AI. */
export function buildBlockedToolResponse(toolName: string): {
  content: string;
  state: { content: [{ text: string; type: 'text' }]; isError: boolean };
  success: boolean;
} {
  const message =
    `The tool "${toolName}" has been disabled by the user and cannot be executed. ` +
    `Please inform the user that this tool is currently disabled and can be re-enabled in Settings > Connectors.`;
  return {
    content: message,
    state: { content: [{ text: message, type: 'text' }], isError: false },
    success: true,
  };
}
