import { connectorToolIdentifier } from '@lobechat/types';

import type { UserConnectorItem } from '../schemas';

type RankedRow = Pick<
  UserConnectorItem,
  'agentId' | 'id' | 'identifier' | 'metadata' | 'visibility' | 'workspaceId'
>;

/**
 * How a run ranks one connector row against another of its identifier:
 *
 * 1. binding — agent-OWNED by this agent > MOUNTED by this agent > free base;
 * 2. within a binding — the owner's private row in this workspace > the
 *    owner's personal row > the workspace's shared row.
 */
const connectorRunRank = (
  row: RankedRow,
  { agentId, workspaceId }: { agentId?: string; workspaceId?: string },
) => {
  const binding =
    agentId && row.agentId === agentId
      ? 2
      : agentId && row.metadata?.mountedByAgentId === agentId
        ? 1
        : 0;
  const ownership = !workspaceId
    ? 0
    : row.workspaceId === workspaceId && row.visibility === 'private'
      ? 2
      : row.workspaceId === null
        ? 1
        : 0;
  return { binding, rank: binding * 3 + ownership };
};

/**
 * One row per identifier, the highest {@link connectorRunRank}; equal ranks
 * keep the first row (callers pass rows in resolution order: identifier, id).
 */
export const pickConnectorByPriority = <T extends RankedRow>(
  rows: T[],
  context: { agentId?: string; workspaceId?: string },
): T[] => {
  const byIdentifier = new Map<string, T>();
  for (const row of rows) {
    const current = byIdentifier.get(row.identifier);
    if (!current || connectorRunRank(row, context).rank > connectorRunRank(current, context).rank)
      byIdentifier.set(row.identifier, row);
  }
  return [...byIdentifier.values()];
};

/**
 * The connector rows a run turns into tool sets, each with its tool prefix
 * ({@link connectorToolIdentifier}). A row bound to the run's agent (its own,
 * or mounted on it) still stands alone for its identifier: the agent's setup
 * chose it. Otherwise every row of the identifier the run may use is its own
 * tool set — the workspace's shared one and the caller's private and personal
 * ones may connect different accounts and expose different tools. Rows sharing
 * a prefix (duplicate shared rows written before identifier claims) keep the
 * first. Within an identifier the highest rank comes first.
 */
export const pickConnectorToolSets = <T extends RankedRow>(
  rows: T[],
  context: { agentId?: string; workspaceId?: string },
): (T & { toolIdentifier: string })[] => {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(row.identifier, [...(groups.get(row.identifier) ?? []), row]);

  return [...groups.values()].flatMap((group) => {
    const ranked = group
      .map((row, order) => ({ order, row, ...connectorRunRank(row, context) }))
      .sort((a, b) => b.rank - a.rank || a.order - b.order);
    const kept = ranked[0].binding > 0 ? [ranked[0]] : ranked;
    const byPrefix = new Map<string, T & { toolIdentifier: string }>();
    for (const { row } of kept) {
      const toolIdentifier = connectorToolIdentifier(row, context.workspaceId);
      if (!byPrefix.has(toolIdentifier)) byPrefix.set(toolIdentifier, { ...row, toolIdentifier });
    }
    return [...byPrefix.values()];
  });
};
