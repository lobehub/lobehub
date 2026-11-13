import { hasCallableMcpEndpoint, hasMandatoryApproval } from '@lobechat/const';

import { lambdaClient } from '@/libs/trpc/client';

import type { ToolStore } from '../../store';
import { connectorSelectors } from './selectors';
import type { ConnectorWithTools } from './types';

export type ConnectorSnapshot = Awaited<ReturnType<ToolStore['getConnectorForEdit']>>;
type ConnectorPatch = Parameters<ToolStore['updateConnector']>[1];

/**
 * Whether an MCP install from `sourceType` may overwrite a stored row of the
 * same identifier: one from the same source, or the endpoint-less tool
 * projection a legacy marketplace plugin left (`connector.syncPluginTools`).
 * Builtin tools and Composio connections are never MCP servers to replace.
 */
const isReplaceableBy = (existing: ConnectorWithTools, sourceType: 'custom' | 'marketplace') => {
  if (existing.metadata?.composio) return false;
  if (existing.sourceType === sourceType) return true;
  return existing.sourceType === 'marketplace' && !hasCallableMcpEndpoint(existing);
};

/**
 * Read the connector an install is about to overwrite: `connector.create`
 * upserts on the identifier, whatever source the stored row came from, so a
 * row the install may not replace (see {@link isReplaceableBy}) is refused.
 * Returns the stored row's snapshot for {@link restoreConnector}.
 */
export const snapshotReplacedConnector = async (
  identifier: string,
  sourceType: 'custom' | 'marketplace',
  get: () => ToolStore,
): Promise<ConnectorSnapshot | undefined> => {
  await get().fetchConnectors();
  const existing = connectorSelectors.connectorByIdentifier(identifier)(get());
  if (!existing) return;
  if (!isReplaceableBy(existing, sourceType)) {
    throw new Error(
      `A connector with the identifier "${identifier}" already exists. Remove it before adding this MCP server.`,
    );
  }
  return get().getConnectorForEdit(existing.id);
};

/**
 * Put a connector back the way it was before an install's `create` or an
 * OAuth edit overwrote it. A row that was connected is connected again:
 *
 * - the edit read withholds OAuth tokens, so an OAuth row keeps the tokens it
 *   holds now (dropped when they belong to the endpoint it moves back off),
 *   and its server answers whether it still connects;
 * - any other row is re-marked connected from its own tool list without
 *   reaching the server.
 *
 * Either way the row's tool list replaces the one the install synced, so
 * tools only the failed install listed are dropped again, and a tool the
 * market made `always` keeps its mandatory approval.
 */
export const restoreConnector = async (snapshot: ConnectorSnapshot, get: () => ToolStore) => {
  const { credentials, id, mcpServerUrl, mcpStdioConfig, oidcConfig, status, tools } = snapshot;
  const tokensWithheld = !!oidcConfig && !credentials;
  const current = connectorSelectors.connectorById(id)(get());
  const movesEndpoint = (current?.mcpServerUrl ?? null) !== (mcpServerUrl ?? null);

  await get().updateConnector(id, {
    ...(!tokensWithheld
      ? { credentials: (credentials ?? null) as ConnectorPatch['credentials'] }
      : movesEndpoint
        ? { credentials: null }
        : {}),
    isEnabled: snapshot.isEnabled,
    // `null` clears what the failed install wrote, so an endpoint-less row
    // (a legacy plugin's tool projection) is not left on the new endpoint
    mcpConnectionType: (snapshot.mcpConnectionType ?? null) as ConnectorPatch['mcpConnectionType'],
    mcpServerUrl: mcpServerUrl ?? null,
    mcpStdioConfig: mcpStdioConfig ?? null,
    metadata: snapshot.metadata ?? {},
    name: snapshot.name,
    // `create` re-sources the row: a custom install over a legacy marketplace
    // projection left it `custom`, which a marketplace reinstall would refuse
    ...(snapshot.sourceType === 'custom' || snapshot.sourceType === 'marketplace'
      ? { sourceType: snapshot.sourceType }
      : {}),
    // A row without an OAuth client drops the one the failed attempt stored.
    // One that had a client keeps the stored one: its secret is withheld too.
    ...(oidcConfig ? {} : { oidcConfig: null }),
  });
  if (status !== 'connected') return;
  if (tokensWithheld) {
    // Connected or `error`, as its server answers
    await get()
      .syncConnectorTools(id, { pruneMissingAutoTools: true })
      .catch(() => {});
    return;
  }
  await lambdaClient.connector.syncToolsFromClientById.mutate({
    id,
    pruneMissingAutoTools: true,
    tools: tools.map((tool) => ({
      description: tool.description ?? undefined,
      // The sync rebuilds each tool's metadata from what it is sent, so a
      // tool the market made `always` must say so again to keep its mark
      humanIntervention: hasMandatoryApproval(tool.metadata) ? ('always' as const) : undefined,
      inputSchema: (tool.inputSchema ?? undefined) as Record<string, unknown> | undefined,
      toolName: tool.toolName,
      visibility: (tool.metadata as { visibility?: string[] } | null)?.visibility,
    })),
  });
  await get().fetchConnectors();
};
