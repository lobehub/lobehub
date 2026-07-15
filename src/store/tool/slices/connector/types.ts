import type { ConnectorToolPermission } from '@/database/schemas';

export interface ConnectorTool {
  crudType: string;
  description: string | null;
  displayName: string | null;
  id: string;
  inputSchema: Record<string, unknown> | null;
  permission: ConnectorToolPermission;
  toolName: string;
  userConnectorId: string;
}

export interface ConnectorWithTools {
  /** Set when this connector is fully owned by an agent (Copy / Connect-new). */
  agentId?: string | null;
  credentials: unknown;
  id: string;
  identifier: string;
  isEnabled: boolean;
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

/**
 * An agent-owned connector as returned by `connector.listAgentBound`, enriched
 * with the owning agent's display info for the unified settings attribution
 * badge (LOBE-11682). Server-resolved so the page needs no per-agent loading.
 */
export interface AgentBoundConnector extends ConnectorWithTools {
  agentAvatar: string | null;
  agentTitle: string | null;
}
