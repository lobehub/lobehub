import { MARKETPLACE_INSTALL_COMPLETED_KEY } from '@lobechat/const';
import type { ToolManifest } from '@lobechat/types';
import debug from 'debug';

import { lambdaClient } from '@/libs/trpc/client';
import {
  type ConnectorSnapshot,
  restoreConnector,
  snapshotReplacedConnector,
} from '@/store/tool/slices/connector/replaceConnector';
import { connectorSelectors } from '@/store/tool/slices/connector/selectors';
import type { ToolStore } from '@/store/tool/store';

import { cloudManifestTools } from './cloudManifest';

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
  /**
   * OAuth only: the marketplace row the authorization overwrote, read before it
   * (`snapshotReplacedConnector`). None means the authorization created the row.
   */
  oauthReplaced?: ConnectorSnapshot;
  signal: AbortSignal;
}

/**
 * The replacement row never carries the install mark, even over a finished
 * install: until its tools are synced it must stay uncallable. The mark is
 * written last, and a failed reinstall restores the previous row with its mark.
 */
const buildCreatePayload = ({
  connection,
  description,
  icon,
  identifier,
  manifest,
  name,
}: InstallMarketplaceConnectorParams): CreateConnectorPayload => {
  // The version goes with each call the Market is told about
  const metadata: Record<string, unknown> = {
    avatar: icon,
    description,
    version: manifest.version,
  };
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

/**
 * The install's tool list replaces the stored one, as a plugin install replaced
 * its manifest: a reinstall drops the tools the server no longer lists.
 */
const REPLACE_TOOLS = { pruneMissingAutoTools: true };

/** A cloud server runs in the market: its tool list is the manifest the market served. */
const syncCloudTools = async (connectorId: string, manifest: ToolManifest) => {
  await lambdaClient.connector.syncToolsFromClientById.mutate({
    id: connectorId,
    ...REPLACE_TOOLS,
    tools: cloudManifestTools(manifest),
  });
};

/**
 * Store a marketplace MCP install as a `user_connectors` row with its tools,
 * then mark the install finished. Only the mark lets the runtime call a
 * marketplace row (see `isMarketplaceInstallCompleted`). When a later step
 * fails or the install is canceled, a row this call created is removed and a
 * row it reinstalled over is restored.
 */
export const installMarketplaceConnector = async (
  params: InstallMarketplaceConnectorParams,
  get: () => ToolStore,
): Promise<void> => {
  const { identifier, isOAuth, manifest, signal } = params;

  let connectorId: string;
  let isNew = false;
  let snapshot: ConnectorSnapshot | undefined;

  if (isOAuth) {
    const connector = connectorSelectors.connectorByIdentifier(identifier)(get());
    if (!connector) throw new Error('The MCP connector did not finish authorization');
    connectorId = connector.id;
    // Authorization already wrote the row: a cancel while finishing removes the
    // row it created, or restores the one it authorized over
    snapshot = params.oauthReplaced;
    isNew = !params.oauthReplaced;
  } else {
    snapshot = await snapshotReplacedConnector(identifier, 'marketplace', get);
    ({ id: connectorId, isNew } = await get().createConnector(buildCreatePayload(params)));
  }

  try {
    // The create's own list refresh may have failed, leaving the replaced row in
    // the list the steps below read (its transport, its metadata)
    if (!isOAuth) await get().fetchConnectors();
    // An OAuth authorization synced a new row's tools already; over an existing
    // row it only added to them, so a reinstall lists them again to drop the rest
    if (!isOAuth || !isNew) {
      signal.throwIfAborted();
      if (params.connection.type === 'cloud') await syncCloudTools(connectorId, manifest);
      else await get().syncConnectorTools(connectorId, REPLACE_TOOLS);
    }

    signal.throwIfAborted();
    // `update` replaces the whole metadata column: merge onto the stored row,
    // never write the mark alone over headers / endpoint the row carries.
    const connector = connectorSelectors.connectorById(connectorId)(get());
    if (!connector) throw new Error('The installed MCP connector could not be loaded');
    await get().updateConnector(connectorId, {
      metadata: { ...connector.metadata, [MARKETPLACE_INSTALL_COMPLETED_KEY]: true },
    });
    // A cancel that arrived while the mark was written still undoes the install.
    signal.throwIfAborted();
  } catch (error) {
    // A failed rollback is only logged: an unmarked row stays uncallable.
    if (isNew) {
      await get()
        .deleteConnector(connectorId)
        .catch((rollbackError) => {
          log('rollback of connector %s (%s) failed: %O', connectorId, identifier, rollbackError);
        });
    } else if (snapshot) {
      await restoreConnector(snapshot, get).catch((rollbackError) => {
        log('restore of connector %s (%s) failed: %O', connectorId, identifier, rollbackError);
      });
    }
    throw error;
  }
};
