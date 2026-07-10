import type { ConnectorWithTools } from './types';

export interface ConnectorState {
  connectorCreating: boolean;
  connectors: ConnectorWithTools[];
  connectorSyncing: Record<string, boolean>;
  isConnectorsInit: boolean;
}

export const initialConnectorState: ConnectorState = {
  connectorCreating: false,
  connectors: [],
  connectorSyncing: {},
  isConnectorsInit: false,
};
