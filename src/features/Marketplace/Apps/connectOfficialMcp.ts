import type { OfficialMcpServerType } from '@lobechat/const';

import { connectorSelectors } from '@/store/tool/slices/connector/selectors';
import type { ToolStore } from '@/store/tool/store';
import { waitForConnectorOAuth } from '@/utils/connectorOAuth';
import { executeOAuthCreate } from '@/utils/connectorOAuthCreate';

/**
 * Connect a vendor's official remote MCP server as a regular HTTP connector.
 *
 * OAuth servers create the row and run the standard MCP authorization (the
 * server resolves the client through CIMD or DCR); public servers create the
 * row and list its tools. Either way a row this attempt created is rolled back
 * when the server cannot be reached or authorized.
 */
export const connectOfficialMcp = async (
  server: OfficialMcpServerType,
  popup: Window | null | undefined,
  get: () => ToolStore,
): Promise<void> => {
  const { createConnector, deleteConnector, fetchConnectors, startConnectorOAuth } = get();
  const base = {
    identifier: server.identifier,
    mcpConnectionType: 'http' as const,
    mcpServerUrl: server.url,
    metadata: { avatar: server.icon, description: server.description },
    name: server.label,
    sourceType: 'custom' as const,
  };

  if (server.auth === 'oauth') {
    await executeOAuthCreate({ ...base, oidcConfig: { scheme: 'dcr' as const } }, popup, {
      createConnector,
      deleteConnector,
      isConnectorConnected: async (id) => {
        await fetchConnectors();
        return connectorSelectors.connectorById(id)(get())?.status === 'connected';
      },
      startConnectorOAuth,
      waitForConnectorOAuth,
    });
    await fetchConnectors();
    return;
  }

  const { id, isNew } = await createConnector(base);
  try {
    await get().syncConnectorTools(id);
  } catch (error) {
    if (isNew) await deleteConnector(id);
    throw error;
  }
};
