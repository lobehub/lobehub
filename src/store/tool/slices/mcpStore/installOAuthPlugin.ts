import type { ToolManifest } from '@lobechat/types';

import { buildClientConnectorManifests } from '@/helpers/toolEngineering/buildClientConnectorManifests';
import type { HttpMCPClientParams } from '@/libs/mcp/types';
import { connectorSelectors } from '@/store/tool/slices/connector/selectors';
import type { ToolStore } from '@/store/tool/store';
import { waitForConnectorOAuth } from '@/utils/connectorOAuth';
import { executeOAuthCreate } from '@/utils/connectorOAuthCreate';

interface InstallOAuthPluginParams {
  connection: HttpMCPClientParams;
  description?: string;
  icon?: string;
  identifier: string;
  name: string;
  popup: Window | null | undefined;
  signal: AbortSignal;
}

/** Authorize before reading tools. Tokens stay in the connector's encrypted credentials. */
export const installOAuthPlugin = async (
  { connection, description, icon, identifier, name, popup, signal }: InstallOAuthPluginParams,
  get: () => ToolStore,
): Promise<ToolManifest> => {
  const { createConnector, deleteConnector, fetchConnectors, startConnectorOAuth } = get();
  const auth = connection.auth;

  await executeOAuthCreate(
    {
      identifier,
      mcpConnectionType: 'http',
      mcpServerUrl: connection.url,
      metadata: { avatar: icon, customHeaders: connection.headers, description },
      name,
      oidcConfig: {
        clientId: auth?.clientId,
        clientSecret: auth?.clientSecret,
        scheme: auth?.clientId ? 'pre_registration' : 'dcr',
        scopes: auth?.scope?.split(/\s+/).filter(Boolean),
      },
      sourceType: 'marketplace',
    },
    popup,
    {
      createConnector,
      deleteConnector,
      isConnectorConnected: async (id) => {
        await fetchConnectors();
        return connectorSelectors.connectorById(id)(get())?.status === 'connected';
      },
      startConnectorOAuth: async (id) => {
        signal.throwIfAborted();
        return startConnectorOAuth(id);
      },
      waitForConnectorOAuth: (window, id, url) => waitForConnectorOAuth(window, id, url, signal),
    },
  );

  signal.throwIfAborted();
  await fetchConnectors();
  signal.throwIfAborted();
  const connector = connectorSelectors.connectorByIdentifier(identifier)(get());
  if (!connector || connector.status !== 'connected') {
    throw new Error('The MCP connector did not finish authorization');
  }

  const [manifest] = buildClientConnectorManifests([connector]);
  return {
    ...manifest,
    api: manifest?.api ?? [],
    identifier,
    meta: { ...manifest?.meta, avatar: icon, description, title: name },
  };
};
