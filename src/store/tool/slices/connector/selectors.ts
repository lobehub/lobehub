import type { ToolStore } from '../../store';
import type { ConnectorTool, ConnectorWithTools } from './types';

const connectorList = (s: ToolStore): ConnectorWithTools[] => s.connectors;

const connectorById =
  (id: string) =>
  (s: ToolStore): ConnectorWithTools | undefined =>
    s.connectors.find((c) => c.id === id);

const connectorByIdentifier =
  (identifier: string) =>
  (s: ToolStore): ConnectorWithTools | undefined =>
    s.connectors.find((c) => c.identifier === identifier);

const enabledConnectors = (s: ToolStore): ConnectorWithTools[] =>
  s.connectors.filter((c) => c.isEnabled);

const connectedConnectors = (s: ToolStore): ConnectorWithTools[] =>
  s.connectors.filter((c) => c.status === 'connected');

const notConnectedConnectors = (s: ToolStore): ConnectorWithTools[] =>
  s.connectors.filter((c) => c.status !== 'connected');

interface GroupedTools {
  readTools: ConnectorTool[];
  writeTools: ConnectorTool[];
}

const connectorToolsGrouped =
  (connectorId: string) =>
  (s: ToolStore): GroupedTools => {
    const connector = s.connectors.find((c) => c.id === connectorId);
    if (!connector) return { readTools: [], writeTools: [] };

    // Show ALL tools in the settings UI (including disabled ones so users can re-enable them).
    // Disabled tools are filtered out at runtime in buildConnectorManifests / queryByConnectorIds.
    return {
      readTools: connector.tools.filter((t) => t.crudType === 'read'),
      writeTools: connector.tools.filter((t) => t.crudType !== 'read'),
    };
  };

const isSyncing =
  (connectorId: string) =>
  (s: ToolStore): boolean =>
    s.connectorSyncing[connectorId] ?? false;

export const connectorSelectors = {
  connectedConnectors,
  connectorById,
  connectorByIdentifier,
  connectorList,
  connectorToolsGrouped,
  connectorToolsGroupedByIdentifier:
    (identifier: string) =>
    (s: ToolStore): { readTools: ConnectorTool[]; writeTools: ConnectorTool[] } => {
      const connector = connectorByIdentifier(identifier)(s);
      if (!connector) return { readTools: [], writeTools: [] };
      return connectorToolsGrouped(connector.id)(s);
    },
  enabledConnectors,
  isSyncing,
  isSyncingByIdentifier:
    (identifier: string) =>
    (s: ToolStore): boolean => {
      const connector = connectorByIdentifier(identifier)(s);
      return connector ? (s.connectorSyncing[connector.id] ?? false) : false;
    },
  notConnectedConnectors,
};
