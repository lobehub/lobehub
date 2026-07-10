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
}
