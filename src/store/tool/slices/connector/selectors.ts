import {
  hasCallableMcpEndpoint,
  isMarketplaceInstallCompleted,
  isMarketplaceInstallRunnable,
} from '@lobechat/const';

import type { ToolStoreState } from '../../initialState';
import type { ToolStore } from '../../store';
import type { AgentBoundConnector, ConnectorTool, ConnectorWithTools } from './types';

// `?? []` tolerates a partially-initialized store (e.g. in unit-test mocks);
// the real store always seeds `connectors: []` via initialState.
const connectorList = (s: ToolStore): ConnectorWithTools[] => s.connectors ?? [];

/** All agent-owned connectors across agents, for the unified settings page. */
const agentBoundConnectors = (s: ToolStore): AgentBoundConnector[] => s.agentBoundConnectors ?? [];

// By-id lookups span both pools: base connectors (`s.connectors`) and the
// agent-bound aggregate (`s.agentBoundConnectors`). The unified settings page
// reuses ConnectorDetail (keyed by connector id) for agent connectors, so the
// detail panel must resolve either kind. Ids are UUIDs — no collision.
const allById =
  (id: string) =>
  (s: ToolStore): ConnectorWithTools | undefined =>
    (s.connectors ?? []).find((c) => c.id === id) ??
    (s.agentBoundConnectors ?? []).find((c) => c.id === id);

const connectorById =
  (id: string) =>
  (s: ToolStore): ConnectorWithTools | undefined =>
    allById(id)(s);

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

/**
 * Marketplace MCPs whose install finished on the connector path. An OAuth row
 * can connect after the user canceled, so only the install's own mark counts.
 */
const installedMarketplaceConnectors = (s: ToolStoreState): ConnectorWithTools[] =>
  (s.connectors ?? []).filter(
    (c) =>
      c.sourceType === 'marketplace' &&
      hasCallableMcpEndpoint(c) &&
      isMarketplaceInstallCompleted(c.metadata),
  );

const isMarketplaceConnectorInstalled =
  (identifier: string) =>
  (s: ToolStoreState): boolean =>
    installedMarketplaceConnectors(s).some((c) => c.identifier === identifier);

/**
 * Finished marketplace installs that have no legacy plugin row. Lists show
 * them beside installed plugins; one with a legacy row is listed as that plugin.
 */
const marketplaceMcpConnectors = (s: ToolStoreState): ConnectorWithTools[] => {
  const legacy = new Set((s.installedPlugins ?? []).map((plugin) => plugin.identifier));
  return installedMarketplaceConnectors(s).filter((c) => !legacy.has(c.identifier));
};

/**
 * The marketplace connector `identifier`'s tools run on, whether or not a
 * legacy plugin row remains: a call goes to a connector with an endpoint
 * before the plugin, so its connection settings are edited on the connector.
 */
const marketplaceMcpConnectorByIdentifier =
  (identifier: string) =>
  (s: ToolStoreState): ConnectorWithTools | undefined =>
    (s.connectors ?? []).find(
      (c) =>
        c.identifier === identifier && c.sourceType === 'marketplace' && hasCallableMcpEndpoint(c),
    );

/** MCP servers the user added as connectors: custom ones and marketplace installs. */
const userMcpConnectors = (s: ToolStoreState): ConnectorWithTools[] => [
  ...(s.connectors ?? []).filter((c) => c.sourceType === 'custom'),
  ...marketplaceMcpConnectors(s),
];

/** Remote marketplace OAuth MCPs also execute with server-held credentials. */
const executableMcpConnectors = (
  s: Pick<ToolStoreState, 'connectors' | 'installedPlugins'>,
): ConnectorWithTools[] => {
  // A late OAuth callback may connect after the user canceled installation.
  // Marketplace tools enter the runtime only once the install has finished and
  // the row is connected, the rule every call path applies.
  const installed = new Set((s.installedPlugins ?? []).map((plugin) => plugin.identifier));
  return (s.connectors ?? []).filter(
    (c) =>
      c.sourceType === 'custom' ||
      (c.sourceType === 'marketplace' &&
        hasCallableMcpEndpoint(c) &&
        isMarketplaceInstallRunnable(c, installed.has(c.identifier))),
  );
};

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
    const connector = allById(connectorId)(s);
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

/**
 * The connector a conversation of `agentId` resolves `identifier` to, mirroring
 * the server's agent-aware resolution: the agent's own row first (agent-owned
 * over mounted), else the base connector. Agent tools are only known once that
 * agent's list has loaded.
 */
/** Mounted (locked) to an agent other than `agentId`; without one, to any agent. */
const isMountedByAnotherAgent = (connector: ConnectorWithTools, agentId?: string) => {
  const mountedBy = connector.metadata?.mountedByAgentId;

  return typeof mountedBy === 'string' && mountedBy !== '' && mountedBy !== agentId;
};

const connectorByIdentifierForAgent =
  (identifier: string, agentId?: string) =>
  (s: ToolStore): ConnectorWithTools | undefined => {
    const agentRows = agentId
      ? (s.agentConnectors?.[agentId] ?? []).filter((c) => c.identifier === identifier)
      : [];

    return (
      agentRows.find((c) => c.agentId === agentId) ??
      agentRows[0] ??
      // A base connector another agent mounted serves only that agent, as the
      // server's scope rule has it (`ConnectorModel.scopePredicate`)
      (s.connectors ?? []).find(
        (c) => c.identifier === identifier && !isMountedByAnotherAgent(c, agentId),
      )
    );
  };

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
  agentBoundConnectors,
  agentConnectors,
  agentOverriddenIdentifiers,
  agentToolBadge,
  connectedConnectors,
  connectorById,
  connectorByIdentifier,
  connectorByIdentifierForAgent,
  connectorList,
  isAgentConnectorsInit,
  connectorToolsGrouped,
  customConnectors,
  executableMcpConnectors,
  installedMarketplaceConnectors,
  isMarketplaceConnectorInstalled,
  marketplaceMcpConnectorByIdentifier,
  marketplaceMcpConnectors,
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
  userMcpConnectors,
};
