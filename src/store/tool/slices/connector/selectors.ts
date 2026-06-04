import { ConnectorToolPermission } from '@/database/schemas';

import type { ToolStore } from '../../store';
import type { ConnectorTool, ConnectorWithTools } from './types';

const connectorList = (s: ToolStore): ConnectorWithTools[] => s.connectors;

const connectorById =
  (id: string) =>
  (s: ToolStore): ConnectorWithTools | undefined =>
    s.connectors.find((c) => c.id === id);

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

    const visibleTools = connector.tools.filter(
      (t) => t.permission !== ConnectorToolPermission.disabled,
    );

    return {
      readTools: visibleTools.filter((t) => t.crudType === 'read'),
      writeTools: visibleTools.filter((t) => t.crudType !== 'read'),
    };
  };

const isSyncing =
  (connectorId: string) =>
  (s: ToolStore): boolean =>
    s.connectorSyncing[connectorId] ?? false;

export const connectorSelectors = {
  connectedConnectors,
  connectorById,
  connectorList,
  connectorToolsGrouped,
  enabledConnectors,
  isSyncing,
  notConnectedConnectors,
};
