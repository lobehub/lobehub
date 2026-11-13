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
 * Put a reinstalled connector back the way it was before `create` overwrote
 * it. Its tools are untouched by a failed sync, so a row that was connected is
 * re-marked connected from its own tool list without reaching the server.
 */
export const restoreConnector = async (snapshot: ConnectorSnapshot, get: () => ToolStore) => {
  const { credentials, id, mcpServerUrl, mcpStdioConfig, oidcConfig, status, tools } = snapshot;
  await get().updateConnector(id, {
    // The edit read withholds OAuth tokens; never clear them with that `null`.
    ...(credentials || !oidcConfig
      ? { credentials: (credentials ?? null) as ConnectorPatch['credentials'] }
      : {}),
    isEnabled: snapshot.isEnabled,
    mcpConnectionType: (snapshot.mcpConnectionType ??
      undefined) as ConnectorPatch['mcpConnectionType'],
    mcpServerUrl: mcpServerUrl ?? undefined,
    mcpStdioConfig: mcpStdioConfig ?? undefined,
    metadata: snapshot.metadata ?? {},
    name: snapshot.name,
  });
  if (status !== 'connected') return;
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
