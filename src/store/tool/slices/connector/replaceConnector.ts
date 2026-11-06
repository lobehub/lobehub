import { hasCallableMcpEndpoint } from '@lobechat/const';

import { lambdaClient } from '@/libs/trpc/client';

import type { ToolStore } from '../../store';
import { connectorSelectors } from './selectors';

export type ConnectorSnapshot = Awaited<ReturnType<ToolStore['getConnectorForEdit']>>;
type ConnectorPatch = Parameters<ToolStore['updateConnector']>[1];

/**
 * Read the connector an install is about to overwrite: `connector.create`
 * upserts on the identifier, whatever source the stored row came from. A row
 * the user added from another source is refused rather than replaced; an
 * endpoint-less row is only a tool projection and may be taken over.
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
  if (existing.sourceType !== sourceType && hasCallableMcpEndpoint(existing)) {
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
