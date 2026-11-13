import { hasCallableMcpEndpoint } from '@lobechat/const';

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
 * - any other row's tools are untouched by a failed sync, so it is re-marked
 *   connected from its own tool list without reaching the server.
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
    mcpConnectionType: (snapshot.mcpConnectionType ??
      undefined) as ConnectorPatch['mcpConnectionType'],
    mcpServerUrl: mcpServerUrl ?? undefined,
    mcpStdioConfig: mcpStdioConfig ?? undefined,
    metadata: snapshot.metadata ?? {},
    name: snapshot.name,
    // A row without an OAuth client drops the one the failed attempt stored.
    // One that had a client keeps the stored one: its secret is withheld too.
    ...(oidcConfig ? {} : { oidcConfig: null }),
  });
  if (status !== 'connected') return;
  if (tokensWithheld) {
    // Connected or `error`, as its server answers
    await get()
      .syncConnectorTools(id)
      .catch(() => {});
    return;
  }
  await lambdaClient.connector.syncToolsFromClientById.mutate({
    id,
    tools: tools.map((tool) => ({
      description: tool.description ?? undefined,
      inputSchema: (tool.inputSchema ?? undefined) as Record<string, unknown> | undefined,
      toolName: tool.toolName,
      visibility: (tool.metadata as { visibility?: string[] } | null)?.visibility,
    })),
  });
  await get().fetchConnectors();
};
