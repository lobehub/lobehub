import { hasCallableMcpEndpoint } from '@lobechat/const';
import {
  connectorShortToolIdentifier,
  connectorToolIdentifier,
  isOwnConnectorRow,
} from '@lobechat/types';
import type { SQL } from 'drizzle-orm';
import { and, asc, inArray, notInArray } from 'drizzle-orm';

import { userConnectors } from '../schemas';
import type { LobeChatDatabase } from '../type';

/** The fields of a connector row a run ranks it by and names its tool set from. */
interface RankedRow {
  agentId: string | null;
  id: string;
  identifier: string;
  metadata?: { mountedByAgentId?: unknown } | null;
  visibility?: string | null;
  workspaceId: string | null;
}

/**
 * How a run ranks one connector row against another of its identifier:
 *
 * 1. binding — agent-OWNED by this agent > MOUNTED by this agent > free base;
 * 2. within a binding — the owner's private row in this workspace > the
 *    owner's personal row > the workspace's shared row.
 */
const connectorRunRank = (
  row: RankedRow,
  { agentId, workspaceId }: { agentId?: string; workspaceId?: string | null },
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
  context: { agentId?: string; workspaceId?: string | null },
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
  context: {
    agentId?: string;
    /** Identifiers of the run's rows a short own-row prefix could collide with. */
    reservedIdentifiers?: ReadonlySet<string>;
    workspaceId?: string | null;
  },
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
      const toolIdentifier = connectorToolIdentifier(
        row,
        context.workspaceId,
        context.reservedIdentifiers,
      );
      if (!byPrefix.has(toolIdentifier)) byPrefix.set(toolIdentifier, { ...row, toolIdentifier });
    }
    return [...byPrefix.values()];
  });
};

/**
 * The identifiers, among the rows `scope` admits, that an own row's short
 * prefix would read as (a connector literally named `mail-12345678`): such a
 * row's tool set takes the whole row id instead. Looked up in the whole scope,
 * not the rows a caller fetched, so every caller names a row alike.
 */
export const queryReservedToolIdentifiers = async (
  db: LobeChatDatabase,
  scope: SQL | undefined,
  rows: RankedRow[],
  workspaceId?: string | null,
): Promise<Set<string>> => {
  const shortPrefixes = rows
    .filter((row) => isOwnConnectorRow(row, workspaceId))
    .map(connectorShortToolIdentifier);
  if (shortPrefixes.length === 0) return new Set();
  const taken = await db
    .select({ identifier: userConnectors.identifier })
    .from(userConnectors)
    .where(and(scope, inArray(userConnectors.identifier, shortPrefixes)));
  return new Set(taken.map((row) => row.identifier));
};

/**
 * The rows `scope` admits (optionally of `identifiers`) as a run's tool sets,
 * in resolution order (identifier, then id), each named collision-free
 * ({@link pickConnectorToolSets}, {@link queryReservedToolIdentifiers}).
 */
export const selectConnectorToolSets = async (
  db: LobeChatDatabase,
  {
    agentId,
    excludedIdentifiers = [],
    identifiers,
    scope,
    workspaceId,
  }: {
    agentId?: string;
    /** Identifiers the caller already has or will drop, so their rows are not read. */
    excludedIdentifiers?: string[];
    identifiers?: string[];
    scope: SQL | undefined;
    workspaceId?: string | null;
  },
) => {
  if (identifiers?.length === 0) return [];
  const rows = await db
    .select()
    .from(userConnectors)
    .where(
      and(
        scope,
        identifiers ? inArray(userConnectors.identifier, identifiers) : undefined,
        excludedIdentifiers.length
          ? notInArray(userConnectors.identifier, excludedIdentifiers)
          : undefined,
      ),
    )
    .orderBy(asc(userConnectors.identifier), asc(userConnectors.id));
  // Collisions are read over the whole scope, so excluding rows keeps every
  // remaining row's prefix.
  const reservedIdentifiers = await queryReservedToolIdentifiers(db, scope, rows, workspaceId);
  return pickConnectorToolSets(rows, { agentId, reservedIdentifiers, workspaceId });
};

/**
 * The rows an agent's configuration may name, as its runs use them: every MCP
 * row its own tool set ({@link pickConnectorToolSets}), every other row (a
 * Composio connection, whose tools another path serves) one per identifier
 * ({@link pickConnectorByPriority}). A configuration naming the identifier is
 * valid while any of them is usable.
 */
export const pickConfigurableConnectors = <
  T extends RankedRow & { mcpConnectionType?: string | null; mcpServerUrl?: string | null },
>(
  rows: T[],
  context: { agentId?: string; workspaceId?: string | null },
): T[] => [
  ...pickConnectorToolSets(rows.filter(hasCallableMcpEndpoint), context),
  ...pickConnectorByPriority(
    rows.filter((row) => !hasCallableMcpEndpoint(row)),
    context,
  ),
];
