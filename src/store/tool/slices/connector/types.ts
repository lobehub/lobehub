import type { ConnectorAuthKind, ConnectorLinkProfile, ConnectorLinkStatus } from '@lobechat/types';

import type { ConnectorToolPermission } from '@/database/schemas';

export interface ConnectorTool {
  crudType: string;
  description: string | null;
  displayName: string | null;
  id: string;
  inputSchema: Record<string, unknown> | null;
  /** Synced metadata; `visibility` is the MCP tool's `_meta.ui.visibility`. */
  metadata?: Record<string, unknown> | null;
  permission: ConnectorToolPermission;
  toolName: string;
  userConnectorId: string;
}

export interface ConnectorWithTools {
  /** Set when this connector is fully owned by an agent (Copy / Connect-new). */
  agentId?: string | null;
  authKind?: ConnectorAuthKind;
  /**
   * Attribution — avatar of the member who authorized this connector (the
   * Composio account linker when present, else the row creator). Server-resolved
   * so the profile can show "authorized by X" without a client member lookup.
   */
  authorizedByAvatar?: string | null;
  /** Attribution — display name of the authorizing member. `null` if unknown. */
  authorizedByName?: string | null;
  credentials: unknown;
  id: string;
  identifier: string;
  isEnabled: boolean;
  links?: ConnectorLinkSummary[];
  mcpConnectionType: string | null;
  mcpServerUrl: string | null;
  metadata: Record<string, unknown> | null;
  name: string;
  sourceType: string;
  status: string;
  tools: ConnectorTool[];
  /** Creator attribution — drives the workspace row-level manage gate. */
  userId?: string | null;
}

export interface ConnectorLinkSummary {
  authorizedByAvatar: string | null;
  authorizedByName: string | null;
  createdAt: string;
  id: string;
  name: string;
  profile: ConnectorLinkProfile | null;
  status: ConnectorLinkStatus;
}

export interface ConnectorAccountFlowOptions {
  popup?: Window | null;
  signal?: AbortSignal;
}
export interface ConnectorAccountFlowResult {
  linkId?: string;
  outcome: 'created' | 'reauthorized' | 'matchedExisting';
}

export const supportsMultipleConnectorAccounts = (
  connector: Pick<ConnectorWithTools, 'authKind' | 'mcpConnectionType' | 'sourceType'>,
): boolean =>
  connector.authKind === 'oauth2' &&
  connector.sourceType === 'custom' &&
  connector.mcpConnectionType === 'http';

export const isConnectorLinkNameConflict = (error: unknown): boolean => {
  const candidate = error as {
    data?: { code?: string };
    shape?: { data?: { code?: string } };
  } | null;
  return candidate?.data?.code === 'CONFLICT' || candidate?.shape?.data?.code === 'CONFLICT';
};

/**
 * An agent-owned connector as returned by `connector.listAgentBound`, enriched
 * with the owning agent's display info for the unified settings attribution
 * badge. Server-resolved so the page needs no per-agent loading.
 */
export interface AgentBoundConnector extends ConnectorWithTools {
  agentAvatar: string | null;
  /** Personal name; resolve the label with `agentDisplayName({ name, title })`. */
  agentName: string | null;
  agentTitle: string | null;
}
