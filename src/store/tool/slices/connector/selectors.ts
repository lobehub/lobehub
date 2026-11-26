import {
  hasCallableMcpEndpoint,
  isMarketplaceInstallCompleted,
  isMarketplaceInstallRunnable,
} from '@lobechat/const';
import { connectorToolIdentifier, type ConnectorVisibility } from '@lobechat/types';

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

/**
 * Whether `connector` lists under a workspace connector page's tab: the
 * caller's private rows under `private`, every other row under `public` (the
 * shared pool). Without a tab (outside a workspace) every row lists.
 */
export const isInConnectorTab = (
  connector: Pick<ConnectorWithTools, 'visibility'>,
  visibility?: ConnectorVisibility,
): boolean => !visibility || (connector.visibility === 'private') === (visibility === 'private');

/** The Composio account a connector row connects (`metadata.composio.connectedAccountId`). */
const composioAccountId = (
  metadata: Record<string, unknown> | null | undefined,
): string | undefined => {
  const composio = metadata?.composio;
  if (!composio || typeof composio !== 'object') return;
  const id = (composio as { connectedAccountId?: unknown }).connectedAccountId;
  return typeof id === 'string' && id ? id : undefined;
};

/**
 * Whether an OAuth integration (a Composio or LobeHub catalog entry) lists under
 * a workspace connector page's tab. The entry carries no visibility; its
 * connector rows do.
 *
 * An entry whose actions act on one account (`accountId`, the Composio
 * connection the store holds for the identifier) lists under that account's
 * row's tab alone: the store keeps one connection per identifier, so with a
 * private and a shared row the entry in the other tab would disconnect,
 * re-authorize or refresh the wrong account. An account no row names stays
 * with the shared pool.
 *
 * Otherwise it lists under `private` when the caller has a private row of it,
 * and under `public` unless its only rows are private: an entry nobody
 * connected stays with the shared pool, where it can be connected.
 */
export const isIntegrationInConnectorTab = (
  identifier: string,
  connectors: Pick<ConnectorWithTools, 'identifier' | 'metadata' | 'visibility'>[],
  visibility?: ConnectorVisibility,
  accountId?: string,
): boolean => {
  if (!visibility) return true;
  const rows = connectors.filter((c) => c.identifier === identifier);
  if (accountId) {
    const accountRow = rows.find((c) => composioAccountId(c.metadata) === accountId);
    return accountRow ? isInConnectorTab(accountRow, visibility) : visibility !== 'private';
  }
  if (rows.length === 0) return visibility !== 'private';

  return rows.some((c) => isInConnectorTab(c, visibility));
};

/**
 * The connectors a run loads from the caller's list, one per identifier, ranked
 * as the server's `ConnectorModel.pickByPriority` ranks base rows: a row
 * mounted on the run's agent outranks a free one, the owner's private row
 * shadows the shared one, and equal ranks keep the lowest id (the server's
 * `resolutionOrder`), never the list order. A row mounted on another agent
 * takes no part (the server's `agentNarrowing`), nor does any mounted row
 * without an agent. Without `includePrivate` (any run but a private agent's
 * own conversation) private rows take no part.
 *
 * Whatever is built per identifier (a tool manifest, its permissions, a menu
 * row) must come from this row: the server executes it.
 */
export const pickRunConnectors = <
  T extends Pick<ConnectorWithTools, 'id' | 'identifier' | 'metadata' | 'visibility'>,
>(
  connectors: T[],
  { agentId, includePrivate }: { agentId?: string; includePrivate: boolean },
): T[] => {
  const mountedBy = (c: T) => {
    const value = c.metadata?.mountedByAgentId;
    return typeof value === 'string' && value ? value : undefined;
  };
  const rank = (c: T) => (mountedBy(c) ? 3 : 0) + (c.visibility === 'private' ? 1 : 0);
  const byIdentifier = new Map<string, T>();
  for (const connector of connectors) {
    if (!includePrivate && connector.visibility === 'private') continue;
    const mount = mountedBy(connector);
    if (mount && mount !== agentId) continue;
    const current = byIdentifier.get(connector.identifier);
    if (
      !current ||
      rank(connector) > rank(current) ||
      (rank(connector) === rank(current) && connector.id < current.id)
    )
      byIdentifier.set(connector.identifier, connector);
  }
  return [...byIdentifier.values()];
};

/**
 * The connectors a run turns into tool sets from the caller's list, each with
 * its tool prefix: the client mirror of `ConnectorModel.resolveToolSets` for a
 * run the server has not listed (`connector.listForRun`). A row mounted on the
 * run's agent stands alone for its identifier; otherwise each row the run may
 * use — the shared one and, with `includePrivate`, the caller's private one —
 * is its own tool set. Rows mounted on another agent take no part.
 */
export const pickRunToolSets = <
  T extends Pick<ConnectorWithTools, 'id' | 'identifier' | 'metadata' | 'visibility'>,
>(
  connectors: T[],
  { agentId, includePrivate }: { agentId?: string; includePrivate: boolean },
): (T & { toolIdentifier: string })[] => {
  const eligible = connectors.filter((c) => {
    if (!includePrivate && c.visibility === 'private') return false;
    const mount = c.metadata?.mountedByAgentId;
    return !(typeof mount === 'string' && mount && mount !== agentId);
  });
  const mounted = new Set(
    eligible
      .filter((c) => agentId && c.metadata?.mountedByAgentId === agentId)
      .map((c) => c.identifier),
  );
  const reserved = new Set(connectors.map((c) => c.identifier));
  const prefixOf = (c: T) => connectorToolIdentifier(c, undefined, reserved);
  const byPrefix = new Map<string, T & { toolIdentifier: string }>();
  for (const connector of [...eligible].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (mounted.has(connector.identifier) && connector.metadata?.mountedByAgentId !== agentId)
      continue;
    const toolIdentifier = prefixOf(connector);
    if (!byPrefix.has(toolIdentifier))
      byPrefix.set(toolIdentifier, { ...connector, toolIdentifier });
  }
  // Keep the list's order
  return eligible.flatMap((c) => {
    const kept = byPrefix.get(prefixOf(c));
    return kept && kept.id === c.id ? [kept] : [];
  });
};

/**
 * The Composio apps a run must not offer: those whose connection rows the
 * caller's list holds, none of which the run may use — a private connection
 * outside its owner's private agent's own conversation. Their tools come from
 * the Composio projection, which no run scope filters, while the execution
 * lookup only serves a connection the run may use, so every call would fail.
 * The server's listing for the conversation (`connector.listForRun`) decides
 * when present; otherwise the run's rows are picked the way the server picks
 * them ({@link pickRunConnectors}). An app with no connection row (a legacy
 * plugin-only connection) is left to its projection.
 */
export const composioIdsOutsideRun = <
  T extends Pick<ConnectorWithTools, 'id' | 'identifier' | 'metadata' | 'visibility'>,
>(
  connectors: T[],
  {
    agentId,
    includePrivate,
    listed,
  }: { agentId?: string; includePrivate: boolean; listed?: Pick<T, 'identifier' | 'metadata'>[] },
): Set<string> => {
  const isComposio = (c: Pick<T, 'metadata'>) => !!c.metadata?.composio;
  const local = connectors.filter(isComposio);
  const usable = new Set(
    (listed
      ? listed.filter(isComposio)
      : pickRunConnectors(local, { agentId, includePrivate })
    ).map((c) => c.identifier),
  );
  return new Set(local.map((c) => c.identifier).filter((id) => !usable.has(id)));
};

const connectorByIdentifier =
  (
    identifier: string,
    /**
     * The workspace connector page's tab. A private and a shared connector may
     * share an identifier; the tab a row was opened from names the one meant.
     */
    visibility?: ConnectorVisibility,
  ) =>
  (s: ToolStore): ConnectorWithTools | undefined => {
    const rows = (s.connectors ?? []).filter((c) => c.identifier === identifier);

    return rows.find((c) => isInConnectorTab(c, visibility)) ?? rows[0];
  };

/**
 * The shared (workspace) row of `identifier`, never a private one. A
 * marketplace or custom MCP install writes the shared row (`connector.create`
 * upserts the row of the visibility it is given, shared by default), so what
 * it replaces, rolls back or reads after authorizing is that row, whichever
 * order the list holds a private row of the same identifier in.
 */
const sharedConnectorByIdentifier =
  (identifier: string) =>
  (s: ToolStore): ConnectorWithTools | undefined =>
    (s.connectors ?? []).find((c) => c.identifier === identifier && c.visibility !== 'private');

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
 * A legacy row stands in for the shared install only: a private install is a
 * tool set of its own (under its own prefix) and is always listed.
 */
const marketplaceMcpConnectors = (s: ToolStoreState): ConnectorWithTools[] => {
  const legacy = new Set((s.installedPlugins ?? []).map((plugin) => plugin.identifier));
  return installedMarketplaceConnectors(s).filter(
    (c) => c.visibility === 'private' || !legacy.has(c.identifier),
  );
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

/** A base connection is available to every agent until one agent mounts it. */
export const isLibraryConnectorForAgent = (connector: ConnectorWithTools, agentId?: string) => {
  const mountedBy = connector.metadata?.mountedByAgentId;
  return !connector.agentId && (!mountedBy || mountedBy === agentId);
};

const userMcpConnectorsForAgent = (agentId: string) => (s: ToolStoreState) =>
  userMcpConnectors(s).filter((connector) => isLibraryConnectorForAgent(connector, agentId));

/** Connected MCP rows a particular agent can use, with its own rows taking precedence. */
const connectedMcpConnectorsForAgent = (
  s: ToolStoreState,
  agentId: string,
): ConnectorWithTools[] => {
  const agentRows = s.agentConnectors?.[agentId] ?? [];
  const overridden = new Set(agentRows.map((row) => row.identifier));
  const baseRows = (s.connectors ?? []).filter(
    (row) => !overridden.has(row.identifier) && isLibraryConnectorForAgent(row, agentId),
  );
  return executableMcpConnectors({
    connectors: [...agentRows, ...baseRows],
    installedPlugins: s.installedPlugins,
  }).filter((row) => row.isEnabled && row.status === 'connected');
};

/**
 * The connector a conversation of `agentId` runs a tool of `identifier` on,
 * mirroring the server's resolution: the agent's own row first (agent-owned
 * over mounted), else the base row whose tool prefix is `identifier`
 * (`connectorToolIdentifier`) — a private row is its own tool set beside the
 * shared one of its connector, so the prefix names the row. Agent tools are
 * only known once that agent's list has loaded.
 */
const connectorByIdentifierForAgent =
  (
    /** A tool's identifier: its connector row's tool prefix. */
    identifier: string,
    agentId?: string,
    /**
     * Whether the caller's private rows take part. Only the server can tell
     * whether a conversation may run one (`connectorRunScope`), so executors
     * resolve through `resolveRunConnector`, which asks it when this decides
     * the row; management surfaces leave the default. A private row the run
     * may not use must not shadow the shared row of the same identifier, or a
     * public agent would execute a connection its scope explicitly excludes.
     */
    { includePrivate = true }: { includePrivate?: boolean } = {},
  ) =>
  (s: ToolStore): ConnectorWithTools | undefined => {
    // Named as the server names them: no own row reads as a listed identifier
    const reserved = new Set((s.connectors ?? []).map((c) => c.identifier));
    // An agent-owned row keeps its identifier; a row mounted on the agent keeps
    // the prefix of its own visibility (a mounted private row is suffixed)
    const agentRows = agentId
      ? (s.agentConnectors?.[agentId] ?? []).filter(
          (c) => connectorToolIdentifier(c, undefined, reserved) === identifier,
        )
      : [];

    // A base connector another agent mounted serves only that agent, as the
    // server's scope rule has it (`ConnectorModel.scopePredicate`).
    const baseRows = (s.connectors ?? []).filter(
      (c) =>
        connectorToolIdentifier(c, undefined, reserved) === identifier &&
        isLibraryConnectorForAgent(c, agentId) &&
        (includePrivate || c.visibility !== 'private'),
    );

    // Duplicate shared rows of one identifier: the lowest id, as the server keeps
    return (
      agentRows.find((c) => c.agentId === agentId) ??
      agentRows[0] ??
      baseRows.sort((a, b) => (a.id < b.id ? -1 : 1))[0]
    );
  };

const isAgentConnectorsInit =
  (agentId: string) =>
  (s: ToolStore): boolean =>
    s.agentConnectorsInit?.[agentId] ?? false;

export const connectorSelectors = {
  /**
   * An account's name on one connector. Account ids are unique per connector
   * only (every legacy connector's account is `lnk_default`), so the lookup
   * is always scoped to the connector that owns the account.
   */
  connectorLinkName:
    (connectorId: string, linkId: string) =>
    (s: ToolStore): string | undefined => {
      const pools = [
        ...(s.connectors ?? []),
        ...(s.agentBoundConnectors ?? []),
        ...Object.values(s.agentConnectors ?? {}).flat(),
      ];
      return pools
        .find((connector) => connector.id === connectorId)
        ?.links?.find((link) => link.id === linkId)?.name;
    },
  /** An account's name on the connector a tool call runs on, resolved as the call is. */
  connectorLinkNameForTool:
    (identifier: string, linkId: string, agentId?: string) =>
    (s: ToolStore): string | undefined =>
      connectorByIdentifierForAgent(
        identifier,
        agentId,
      )(s)?.links?.find((link) => link.id === linkId)?.name,
  agentBoundConnectors,
  agentConnectors,
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
  connectedMcpConnectorsForAgent,
  marketplaceMcpConnectorByIdentifier,
  marketplaceMcpConnectors,
  sharedConnectorByIdentifier,
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
  userMcpConnectorsForAgent,
};
