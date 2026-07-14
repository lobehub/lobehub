import type { ConnectorWithTools } from './types';

export interface ConnectorState {
  /** Agent-scoped connectors (owned + mounted), keyed by agentId. */
  agentConnectors: Record<string, ConnectorWithTools[]>;
  agentConnectorsInit: Record<string, boolean>;
  connectorCreating: boolean;
  connectors: ConnectorWithTools[];
  connectorSyncing: Record<string, boolean>;
  isConnectorsInit: boolean;
}

export const initialConnectorState: ConnectorState = {
  agentConnectors: {},
  agentConnectorsInit: {},
  connectorCreating: false,
  connectors: [],
  connectorSyncing: {},
  isConnectorsInit: false,
};
