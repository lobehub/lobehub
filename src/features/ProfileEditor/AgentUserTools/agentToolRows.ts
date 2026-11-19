import { type AgentPluginEntry, getConnectorMode } from '@lobechat/types';

import type { ConnectorWithTools } from '@/store/tool/slices/connector/types';

/** A tool the library offers this agent, in the order the library lists it. */
export interface LibraryToolOption {
  canDisable: boolean;
  enabled: boolean;
  id: string;
}

/** One row of the agent's tool list: one tool, whichever connection serves it. */
export interface AgentToolRow {
  canDisable: boolean;
  enabled: boolean;
  id: string;
  /** The library offers this tool, so the agent can go back to the library's connection. */
  inLibrary: boolean;
  /** The agent's own connection for this tool; its runs use it instead of the library's. */
  ownConnection?: ConnectorWithTools;
}

interface BuildAgentToolRowsParams {
  agentConnectors: ConnectorWithTools[];
  agentId: string;
  chatConfig?: Parameters<typeof getConnectorMode>[2];
  libraryOptions: LibraryToolOption[];
  plugins: AgentPluginEntry[] | undefined;
}

/**
 * The agent's tools as one list. A tool is listed once however many connections exist for it:
 * the agent's switch is kept per tool, and a run uses the agent's own connection when it has
 * one, the library's otherwise.
 *
 * A row shows when the tool is on, or when the agent holds its own connection for it — that
 * connection exists only here, so it stays visible while off. Rows keep the library's order,
 * and tools the library does not offer follow.
 */
export const buildAgentToolRows = ({
  agentConnectors,
  agentId,
  chatConfig,
  libraryOptions,
  plugins,
}: BuildAgentToolRowsParams): AgentToolRow[] => {
  // A library connection another flow lent to the agent is still the library's.
  const owned = new Map(
    agentConnectors.filter((c) => c.agentId === agentId).map((c) => [c.identifier, c] as const),
  );

  const rows: AgentToolRow[] = [];
  const listed = new Set<string>();

  for (const option of libraryOptions) {
    if (listed.has(option.id)) continue;
    const ownConnection = owned.get(option.id);
    if (!option.enabled && !ownConnection) continue;

    listed.add(option.id);
    rows.push({
      // The library's own state (a connection awaiting authorization, say) does not hold a
      // tool the agent runs on its own connection.
      canDisable: ownConnection ? true : option.canDisable,
      enabled: ownConnection
        ? getConnectorMode(plugins, option.id, chatConfig) === 'auto'
        : option.enabled,
      id: option.id,
      inLibrary: true,
      ownConnection,
    });
  }

  for (const [identifier, ownConnection] of owned) {
    if (listed.has(identifier)) continue;
    rows.push({
      canDisable: true,
      enabled: getConnectorMode(plugins, identifier, chatConfig) === 'auto',
      id: identifier,
      inLibrary: false,
      ownConnection,
    });
  }

  return rows;
};

/** How many tools the agent could turn on: the library's, plus the ones only it has. */
export const countAvailableTools = (rows: AgentToolRow[], libraryTotal: number): number =>
  libraryTotal + rows.filter((row) => !row.inLibrary).length;
