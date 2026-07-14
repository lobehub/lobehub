import type { ToolStore } from '../../store';
import type { ConnectorTool, ConnectorWithTools } from './types';

// `?? []` tolerates a partially-initialized store (e.g. in unit-test mocks);
// the real store always seeds `connectors: []` via initialState.
const connectorList = (s: ToolStore): ConnectorWithTools[] => s.connectors ?? [];

const connectorById =
  (id: string) =>
  (s: ToolStore): ConnectorWithTools | undefined =>
    (s.connectors ?? []).find((c) => c.id === id);

const connectorByIdentifier =
  (identifier: string) =>
  (s: ToolStore): ConnectorWithTools | undefined =>
    (s.connectors ?? []).find((c) => c.identifier === identifier);

const enabledConnectors = (s: ToolStore): ConnectorWithTools[] =>
  (s.connectors ?? []).filter((c) => c.isEnabled);

const connectedConnectors = (s: ToolStore): ConnectorWithTools[] =>
  (s.connectors ?? []).filter((c) => c.status === 'connected');

/** User-added custom connectors (sourceType 'custom'), e.g. OAuth MCP servers. */
const customConnectors = (s: ToolStore): ConnectorWithTools[] =>
  (s.connectors ?? []).filter((c) => c.sourceType === 'custom');

const notConnectedConnectors = (s: ToolStore): ConnectorWithTools[] =>
  (s.connectors ?? []).filter((c) => c.status !== 'connected');

interface GroupedTools {
  createTools: ConnectorTool[];
  deleteTools: ConnectorTool[];
  readTools: ConnectorTool[];
  updateTools: ConnectorTool[];
}

const connectorToolsGrouped =
  (connectorId: string) =>
  (s: ToolStore): GroupedTools => {
    const connector = (s.connectors ?? []).find((c) => c.id === connectorId);
    if (!connector) return { createTools: [], deleteTools: [], readTools: [], updateTools: [] };

    // Show ALL tools in the settings UI (including disabled ones so users can re-enable them).
    // Disabled tools are filtered out at runtime in buildConnectorManifests / queryByConnectorIds.
    return {
      createTools: connector.tools.filter((t) => t.crudType === 'write'),
      deleteTools: connector.tools.filter((t) => t.crudType === 'delete'),
      readTools: connector.tools.filter((t) => t.crudType === 'read'),
      updateTools: connector.tools.filter((t) => t.crudType === 'update'),
    };
  };

const isSyncing =
  (connectorId: string) =>
  (s: ToolStore): boolean =>
    s.connectorSyncing[connectorId] ?? false;

/** An agent's own tools (agent-owned + mounted), for the Agent Tools tab. */
const agentConnectors =
  (agentId: string) =>
  (s: ToolStore): ConnectorWithTools[] =>
    s.agentConnectors?.[agentId] ?? [];

const isAgentConnectorsInit =
  (agentId: string) =>
  (s: ToolStore): boolean =>
    s.agentConnectorsInit?.[agentId] ?? false;

/**
 * The badge kind of an agent tool, derived from its scope + whether a same-named
 * user connector exists:
 * - `agentOnly` — agent-owned, no user connector of the same identifier;
 * - `copy` — agent-owned, and the user also has one of the same identifier;
 * - `linked` — a user-owned row this agent has mounted (referenced + locked).
 */
type AgentToolBadge = 'agentOnly' | 'copy' | 'linked';
const agentToolBadge =
  (agentId: string, connector: ConnectorWithTools) =>
  (s: ToolStore): AgentToolBadge => {
    if (connector.agentId !== agentId) return 'linked'; // mounted user row
    const hasUserSame = (s.connectors ?? []).some(
      (c) => c.identifier === connector.identifier && !c.agentId,
    );
    return hasUserSame ? 'copy' : 'agentOnly';
  };

/** Identifiers of user connectors that an agent has overridden (owns a same-named tool). */
const agentOverriddenIdentifiers =
  (agentId: string) =>
  (s: ToolStore): Set<string> => {
    const owned = (s.agentConnectors?.[agentId] ?? []).filter((c) => c.agentId === agentId);
    return new Set(owned.map((c) => c.identifier));
  };

export const connectorSelectors = {
  agentConnectors,
  agentOverriddenIdentifiers,
  agentToolBadge,
  connectedConnectors,
  connectorById,
  connectorByIdentifier,
  connectorList,
  isAgentConnectorsInit,
  connectorToolsGrouped,
  customConnectors,
  connectorToolsGroupedByIdentifier:
    (identifier: string) =>
    (s: ToolStore): GroupedTools => {
      const connector = connectorByIdentifier(identifier)(s);
      if (!connector) return { createTools: [], deleteTools: [], readTools: [], updateTools: [] };
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
