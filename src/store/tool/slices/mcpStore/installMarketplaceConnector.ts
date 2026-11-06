import { isMarketplaceInstallCompleted, MARKETPLACE_INSTALL_COMPLETED_KEY } from '@lobechat/const';
import type { ToolManifest } from '@lobechat/types';
import debug from 'debug';

import { lambdaClient } from '@/libs/trpc/client';
import { connectorSelectors } from '@/store/tool/slices/connector/selectors';
import type { ToolStore } from '@/store/tool/store';

const log = debug('lobe-mcp:store:installMarketplaceConnector');

type CreateConnectorPayload = Parameters<ToolStore['createConnector']>[0];

interface InstallMarketplaceConnectorParams {
  /** The resolved marketplace connection (`http` / `stdio` / `cloud`), config merged in. */
  connection: Record<string, any>;
  description?: string;
  icon?: string;
  identifier: string;
  /** An OAuth install already created and authorized its connector. */
  isOAuth: boolean;
  /** The manifest read during install; a `cloud` connector takes its tools from it. */
  manifest: ToolManifest;
  name: string;
  signal: AbortSignal;
}

const buildCreatePayload = (
  { connection, description, icon, identifier, name }: InstallMarketplaceConnectorParams,
  /** Reinstalling over a finished install: `create` replaces the metadata, so keep the mark. */
  wasInstalled: boolean,
): CreateConnectorPayload => {
  const metadata: Record<string, unknown> = { avatar: icon, description };
  if (wasInstalled) metadata[MARKETPLACE_INSTALL_COMPLETED_KEY] = true;
  if (connection.headers) metadata.customHeaders = connection.headers;
  const base = { identifier, metadata, name, sourceType: 'marketplace' as const };

  switch (connection.type) {
    case 'http': {
      const token = connection.auth?.type === 'bearer' ? connection.auth.token : undefined;
      return {
        ...base,
        credentials: token ? { token, type: 'bearer' } : undefined,
        mcpConnectionType: 'http',
        mcpServerUrl: connection.url,
      };
    }
    case 'stdio': {
      return {
        ...base,
        mcpConnectionType: 'stdio',
        mcpStdioConfig: {
          args: connection.args ?? [],
          command: connection.command,
          env: connection.env,
        },
      };
    }
    case 'cloud': {
      return {
        ...base,
        mcpConnectionType: 'cloud',
        metadata: { ...metadata, cloudEndPoint: connection.cloudEndPoint },
      };
    }
    default: {
      throw new Error(`Unsupported MCP connection type: ${connection.type}`);
    }
  }
};

/** A cloud server runs in the market: its tool list is the manifest the market served. */
const syncCloudTools = async (connectorId: string, manifest: ToolManifest) => {
  await lambdaClient.connector.syncToolsFromClientById.mutate({
    id: connectorId,
    tools: (manifest.api ?? []).map((api) => ({
      description: api.description,
      inputSchema: api.parameters as Record<string, unknown>,
      toolName: api.name,
    })),
  });
};

/**
 * Store a marketplace MCP install as a `user_connectors` row with its tools,
 * then mark the install finished. Only the mark lets the runtime call a
 * marketplace row (see `isMarketplaceInstallCompleted`). A row this call
 * created is removed again when a later step fails or the install is canceled.
 */
export const installMarketplaceConnector = async (
  params: InstallMarketplaceConnectorParams,
  get: () => ToolStore,
): Promise<void> => {
  const { identifier, isOAuth, manifest, signal } = params;
  const { createConnector, deleteConnector, syncConnectorTools, updateConnector } = get();

  let connectorId: string;
  let isNew = false;

  if (isOAuth) {
    const connector = connectorSelectors.connectorByIdentifier(identifier)(get());
    if (!connector) throw new Error('The MCP connector did not finish authorization');
    connectorId = connector.id;
  } else {
    const existing = connectorSelectors.connectorByIdentifier(identifier)(get());
    const wasInstalled = isMarketplaceInstallCompleted(existing?.metadata);
    ({ id: connectorId, isNew } = await createConnector(buildCreatePayload(params, wasInstalled)));
  }

  try {
    if (!isOAuth) {
      signal.throwIfAborted();
      if (params.connection.type === 'cloud') await syncCloudTools(connectorId, manifest);
      else await syncConnectorTools(connectorId);
    }

    signal.throwIfAborted();
    // `update` replaces the whole metadata column: merge onto the stored row,
    // never write the mark alone over headers / endpoint the row carries.
    const connector = connectorSelectors.connectorById(connectorId)(get());
    if (!connector) throw new Error('The installed MCP connector could not be loaded');
    await updateConnector(connectorId, {
      metadata: { ...connector.metadata, [MARKETPLACE_INSTALL_COMPLETED_KEY]: true },
    });
  } catch (error) {
    if (isNew) {
      await deleteConnector(connectorId).catch((deleteError) => {
        // An unmarked row stays uncallable; log it so a leftover can be traced.
        log('rollback of connector %s (%s) failed: %O', connectorId, identifier, deleteError);
      });
    }
    throw error;
  }
};
