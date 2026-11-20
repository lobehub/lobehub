/**
 * The tool-name prefix of a connector row: what its manifest is keyed by, what
 * the model calls it by, and what a tool call is routed back to the row with.
 *
 * Several rows may share an `identifier` in one run: the workspace's shared
 * connector, the caller's private one, and (in a private agent's workspace
 * run) their personal one. Each is its own tool set — they may connect
 * different accounts, sync at different times and expose different tools — so
 * each needs its own prefix:
 *
 * - a shared row, an agent's own row, and every row outside a workspace keep
 *   `identifier`, so existing tool names and call history are unchanged;
 * - a private row, and a personal row resolved in a workspace run, append a
 *   suffix derived from the row id. It depends on the row alone, so it stays
 *   stable when a sibling row appears or goes, and a stored tool call still
 *   names the row it ran on.
 *
 * Identifiers are free-form, so a connector may literally be named like a
 * suffixed prefix (`mail-12345678`). `reservedIdentifiers` are the identifiers
 * of the rows the run can see: a suffix that would read as one of them takes
 * the whole row id instead, so no two rows of a run ever share a prefix.
 */
export const connectorToolIdentifier = (
  row: {
    agentId?: string | null;
    id: string;
    identifier: string;
    visibility?: string | null;
    workspaceId?: string | null;
  },
  /** The workspace the run is in; omitted or null for a personal run. */
  runWorkspaceId?: string | null,
  /** Identifiers of the rows the run can see (see above). */
  reservedIdentifiers?: ReadonlySet<string>,
): string => {
  if (!isOwnConnectorRow(row, runWorkspaceId)) return row.identifier;
  const short = connectorShortToolIdentifier(row);
  return reservedIdentifiers?.has(short)
    ? `${row.identifier}-${row.id.replaceAll('-', '').toLowerCase()}`
    : short;
};

/**
 * Whether a row's tool set is named apart from its connector's identifier: a
 * private row, or a personal row in a workspace run (an agent's own row never).
 */
export const isOwnConnectorRow = (
  row: { agentId?: string | null; visibility?: string | null; workspaceId?: string | null },
  runWorkspaceId?: string | null,
): boolean =>
  !row.agentId && (row.visibility === 'private' || (!!runWorkspaceId && row.workspaceId === null));

/**
 * The short prefix an own row takes unless a row the run can see is literally
 * named so ({@link connectorToolIdentifier}).
 */
export const connectorShortToolIdentifier = (row: { id: string; identifier: string }): string =>
  `${row.identifier}-${connectorRowSuffix(row.id)}`;

/** Eight hex characters of the row id: `[\w-]`-safe, so tool names stay readable. */
export const connectorRowSuffix = (id: string): string =>
  id.replaceAll('-', '').slice(0, 8).toLowerCase();

/**
 * The identifiers a tool identifier may belong to: itself (a shared row, or a
 * plain identifier that happens to end like a suffix), and the base it names
 * when it ends in a row suffix. A caller resolves the rows of every candidate
 * and keeps the one whose {@link connectorToolIdentifier} matches, so an
 * identifier that merely looks suffixed is never mistaken for another row.
 */
export const connectorIdentifierCandidates = (toolIdentifier: string): string[] => {
  const match = /^(.+)-([\da-f]{8}|[\da-f]{32})$/.exec(toolIdentifier);
  return match ? [toolIdentifier, match[1]] : [toolIdentifier];
};

/**
 * The connector identifier a manifest serves: the base identifier of a
 * connector row's tool set (`manifest.connector`), else its own identifier.
 * Agent configuration (`agents.plugins` pins and disables), share grants and
 * plugin precedence all speak base identifiers.
 */
export const manifestBaseIdentifier = (manifest: {
  connector?: { identifier: string } | null;
  identifier: string;
}): string => manifest.connector?.identifier ?? manifest.identifier;
