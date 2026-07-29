import type { AgentBoundConnector, ConnectorWithTools } from './types';

export interface ConnectorState {
  /**
   * All agent-owned connectors across every agent in the current scope, for the
   * unified connector-settings page (LOBE-11682). Distinct from `agentConnectors`
   * (keyed per-agent, includes mounted rows) — this is the flat aggregate.
   */
  agentBoundConnectors: AgentBoundConnector[];
  /** Agent-scoped connectors (owned + mounted), keyed by agentId. */
  agentConnectors: Record<string, ConnectorWithTools[]>;
  agentConnectorsInit: Record<string, boolean>;
  connectorCreating: boolean;
  connectors: ConnectorWithTools[];
  connectorSyncing: Record<string, boolean>;
  isAgentBoundInit: boolean;
  isConnectorsInit: boolean;
}

export const initialConnectorState: ConnectorState = {
  agentBoundConnectors: [],
  agentConnectors: {},
  agentConnectorsInit: {},
  connectorCreating: false,
  connectors: [],
  connectorSyncing: {},
  isAgentBoundInit: false,
  isConnectorsInit: false,
};
