import { getAllRunConnectors } from '@/services/runConnectors';
import { connectorSelectors } from '@/store/tool/slices/connector/selectors';
import type { ConnectorWithTools } from '@/store/tool/slices/connector/types';
import type { ToolStore } from '@/store/tool/store';

/**
 * The connector row an MCP App's tool prefix names: the local lists' row,
 * else a row the server listed for a conversation (`connector.listForRun`) —
 * the owner's personal connector a private agent's own topic runs is only
 * there.
 */
export const connectorForTool =
  (identifier: string, agentId?: string) =>
  (s: ToolStore): ConnectorWithTools | undefined =>
    connectorSelectors.connectorByIdentifierForAgent(identifier, agentId)(s) ??
    getAllRunConnectors().find((row) => row.toolIdentifier === identifier);
