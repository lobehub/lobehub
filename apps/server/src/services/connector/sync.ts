import {
  hasMandatoryApproval,
  MANDATORY_APPROVAL_KEY,
  requiresSsrfSafeTransport,
  withMandatoryApprovalMark,
} from '@lobechat/const';
import {
  buildMcpToolMetadata,
  getMcpAppEntrypoints,
  resolveMcpUiToolMeta,
} from '@lobechat/const/mcpApp';
import { type LobeChatDatabase } from '@lobechat/database';
import {
  connectorConnectVia,
  connectorDeviceBinding,
  connectorMcpEndpoint,
  shouldConnectViaDevice,
} from '@lobechat/utils/mcpEndpoint';

import type { ConnectorModel, DecryptedConnector } from '@/database/models/connector';
import type { ConnectorLinkModel } from '@/database/models/connectorLink';
import type { ConnectorToolModel } from '@/database/models/connectorTool';
import type { ConnectorCredentials } from '@/database/schemas';
import {
  ConnectorMcpConnectionType,
  ConnectorStatus,
  ConnectorToolPermission,
} from '@/database/schemas';
import type { AuthConfig, McpTool } from '@/libs/mcp';
import { inferCrudType } from '@/libs/mcp/utils';
import { resolveConnectorToolPermission } from '@/server/routers/lambda/_helpers/connectorToolPermission';
import { deviceGateway } from '@/server/services/deviceGateway';
import { mcpService } from '@/server/services/mcp';
import { listMcpToolsOnDevice } from '@/server/services/mcp/deviceTunnel';
import { isMcpAppsEnabled } from '@/server/services/mcp/featureGate';

import {
  getConnectorLinkModel,
  loadConnectorLinksMap,
  pickPrimaryLink,
  withLinkCredentials,
} from './links';
import { ensureFreshConnectorToken, ensureFreshLinkToken } from './tokens';

export interface ConnectorToolSyncContext {
  connectorLinkModel?: ConnectorLinkModel;
  connectorModel: ConnectorModel;
  connectorToolModel: ConnectorToolModel;
}

/**
 * Build the MCP client connection params (with auth) from a connector row.
 *
 * Must match the params agent runs use (`buildConnectorManifests`): the MCP
 * client session is cached by these params, so a view's resource read and
 * tool calls only reach the session its tool ran on when they are equal.
 * `name` is therefore the stable identifier, not the editable display name.
 */
export const buildConnectorMcpParams = (
  connector: DecryptedConnector,
): Parameters<typeof mcpService.listRawTools>[0] => {
  // Only set when bound, as `buildConnectorManifests` does
  const boundDevice = connectorDeviceBinding(connector);
  if (connector.mcpConnectionType === ConnectorMcpConnectionType.stdio) {
    if (!connector.mcpStdioConfig) throw new Error('Missing stdio config');
    return {
      args: connector.mcpStdioConfig.args ?? [],
      ...(boundDevice && { boundDevice }),
      command: connector.mcpStdioConfig.command,
      env: connector.mcpStdioConfig.env,
      name: connector.identifier,
      type: 'stdio',
    };
  }
  if (!connector.mcpServerUrl) throw new Error('Connector has no MCP server URL configured');
  const { auth, headers } = buildHttpAuthFromCredentials(connector.credentials);
  // Custom headers live in `metadata.customHeaders` (plaintext, independent of
  // the single-kind `credentials` column) so they can coexist with any auth
  // type. Merge them on top of any header-type credential headers (older rows
  // stored custom headers as a 'header' credential before this split).
  const customHeaders = connector.metadata?.customHeaders as Record<string, string> | undefined;
  const mergedHeaders = headers || customHeaders ? { ...headers, ...customHeaders } : undefined;
  return {
    auth,
    ...(boundDevice && { boundDevice }),
    // Only set when chosen, as `buildConnectorManifests` does
    ...(connectorConnectVia(connector.metadata) === 'device' && { connectVia: 'device' as const }),
    headers: mergedHeaders,
    name: connector.identifier,
    // On every request to it, the listing and tool calls alike
    ...(requiresSsrfSafeTransport(connector.metadata) ? { ssrfSafe: true } : {}),
    type: 'http',
    url: connector.mcpServerUrl,
  };
};

/**
 * Map stored credentials into the HTTP MCP client's auth config + custom headers.
 *
 * The MCP client only understands `bearer`/`oauth2` auth (both become an
 * `Authorization: Bearer …` header), so:
 * - bearer / apikey → bearer auth
 * - header          → passed through verbatim as request headers
 */
export const buildHttpAuthFromCredentials = (
  credentials: ConnectorCredentials | null,
): { auth?: AuthConfig; headers?: Record<string, string> } => {
  if (!credentials) return {};

  switch (credentials.type) {
    case 'oauth2': {
      // Only the access token: callers refresh it first (ensureFreshConnectorToken),
      // and the MCP client sends nothing else. Refresh metadata here would also
      // make these params, and so the cached MCP session, differ from the agent
      // runtime's for the same connector.
      return { auth: { accessToken: credentials.accessToken, type: 'oauth2' } };
    }
    case 'bearer': {
      return { auth: { token: credentials.token, type: 'bearer' } };
    }
    case 'apikey': {
      return { auth: { token: credentials.apiKey, type: 'bearer' } };
    }
    case 'header': {
      return { headers: credentials.headers };
    }
    default: {
      return {};
    }
  }
};

export interface ConnectorToolSyncOptions {
  /** List with this account's credentials instead of the connector's primary one. */
  linkId?: string;
  /**
   * Drop the `auto` tools the server no longer lists, so they stop being
   * advertised: eval contracts, and an MCP install or reinstall, whose tool
   * list replaces the stored one as a plugin install replaced its manifest.
   * Approval and disabled rows stay as permission tombstones, so neither a later
   * listing nor the rollback of a failed reinstall can bring them back as `auto`.
   */
  pruneMissingAutoTools?: boolean;
}

/** After a sync: delete the connector's `auto` tools that `listedToolNames` no longer has. */
export const pruneMissingAutoConnectorTools = async (
  connectorToolModel: Pick<ConnectorToolModel, 'deleteToolsNotIn' | 'queryByConnector'>,
  connectorId: string,
  listedToolNames: string[],
): Promise<void> => {
  const tombstones = (await connectorToolModel.queryByConnector(connectorId))
    .filter((tool) => tool.permission !== ConnectorToolPermission.auto)
    .map((tool) => tool.toolName);
  await connectorToolModel.deleteToolsNotIn(connectorId, [...listedToolNames, ...tombstones]);
};

/** A tool the caller already listed (a desktop listing, a cloud server's market manifest). */
export interface ConnectorListedTool {
  description?: string;
  /**
   * A manifest tool's `humanIntervention` (cloud marketplace installs):
   * `required` / `always`, or rules or a dynamic config that can ask for
   * either, make a newly synced tool need approval. One that can ask for
   * `always` keeps it on every sync, since no approval mode waives it.
   */
  humanIntervention?: unknown;
  inputSchema?: Record<string, unknown>;
  toolName: string;
  /** The MCP tool's `_meta.ui.visibility`, when it declares one. */
  visibility?: string[];
}

/**
 * Store a tool list the caller already holds, without reaching the server,
 * and mark the connector `connected`. A tool synced before keeps the
 * permission it has.
 */
export const syncConnectorToolsFromList = async (
  connectorId: string,
  tools: ConnectorListedTool[],
  ctx: {
    connectorModel: Pick<ConnectorModel, 'updateStatus'>;
    connectorToolModel: Pick<
      ConnectorToolModel,
      'deleteToolsNotIn' | 'queryByConnector' | 'upsertMany'
    >;
  },
  options: ConnectorToolSyncOptions = {},
): Promise<{ toolCount: number }> => {
  const syncInputs = tools.map((t) => ({
    crudType: inferCrudType(t.toolName),
    // Applies to new tools only: a synced tool keeps the permission it has
    defaultPermission: resolveConnectorToolPermission(t.humanIntervention),
    description: t.description,
    inputSchema: t.inputSchema,
    // Refreshed on every sync, unlike the permission: an `always` the
    // manifest asks for stays mandatory whatever the permission is
    metadata: withMandatoryApprovalMark(buildMcpToolMetadata(t.visibility), t.humanIntervention),
    toolName: t.toolName,
  }));

  await ctx.connectorToolModel.upsertMany(connectorId, syncInputs);
  if (options.pruneMissingAutoTools) {
    await pruneMissingAutoConnectorTools(
      ctx.connectorToolModel,
      connectorId,
      syncInputs.map((tool) => tool.toolName),
    );
  }
  await ctx.connectorModel.updateStatus(connectorId, ConnectorStatus.connected);
  return { toolCount: syncInputs.length };
};

/**
 * A connector this server must not connect to itself (stdio, local network, or
 * set to connect through the device) is listed on a device through the device
 * gateway: the device it is bound to, else the caller's newest capable one.
 * `undefined` for any other, which the server lists itself. Without a gateway
 * (self-hosted) every connector keeps the in-process listing, as agent runs
 * keep the in-process call.
 *
 * An unbound connector is only tunneled to the caller's device when it is the
 * caller's own: a workspace connector another member set up carries that
 * member's credentials, which must not reach a machine they never approved. A
 * bound one always reaches the device its tool calls run on, whoever refreshes.
 */
const listOnDevice = async (
  connector: DecryptedConnector,
  mcpParams: ReturnType<typeof buildConnectorMcpParams>,
  ctx: { serverDB?: LobeChatDatabase; userId?: string | null },
  mcpApps: boolean,
): Promise<McpTool[] | undefined> => {
  if (!deviceGateway.isConfigured) return undefined;
  if (
    !shouldConnectViaDevice(connectorMcpEndpoint(connector), {
      deviceGatewayConfigured: true,
    })
  )
    return undefined;

  if (!mcpParams.boundDevice && connector.userId !== ctx.userId) {
    throw new Error(
      `Connector '${connector.name}' connects through a device, and only the member who set it up can refresh its tools from their desktop app.`,
    );
  }

  return listMcpToolsOnDevice({
    mcpApps,
    params: mcpParams,
    serverDB: ctx.serverDB,
    userId: ctx.userId,
  });
};

/**
 * Connect to a connector's MCP server, fetch its tool list, and sync it into
 * `user_connector_tools`. Refreshes the OAuth token first when needed, and
 * updates the connector status (`connected` on success, `error` on failure).
 *
 * Shared by the `syncTools` tRPC mutation and the OAuth callback so a connector
 * has its tools immediately after authorization — no client round-trip needed.
 */
export const syncConnectorToolsById = async (
  connectorId: string,
  /**
   * `userId` decides the `mcp_apps` flag: with it on, view-only tools are listed
   * too. `serverDB` finds the user's device for a connector the server can't
   * reach itself (`shouldConnectViaDevice`). Required, so each caller decides:
   * `undefined` fails such a sync instead of tunneling it to a device.
   */
  ctx: ConnectorToolSyncContext & {
    serverDB: LobeChatDatabase | undefined;
    userId?: string | null;
  },
  options: ConnectorToolSyncOptions & {
    /**
     * By tool name, the `humanIntervention` a marketplace manifest gives a tool
     * the server lists, which an MCP listing cannot carry (an HTTP marketplace
     * install). It applies as a listed tool's does in
     * {@link syncConnectorToolsFromList}. Without it (a refresh), a synced tool
     * keeps the mandatory approval it has.
     */
    humanInterventions?: ReadonlyMap<string, unknown>;
  } = {},
): Promise<{ toolCount: number }> => {
  let connector = await ctx.connectorModel.findById(connectorId);
  if (!connector) throw new Error('Connector not found');

  if (!connector.mcpServerUrl && connector.mcpConnectionType !== ConnectorMcpConnectionType.stdio) {
    throw new Error('Connector has no MCP server URL configured');
  }

  // Refresh the OAuth access token if it has expired before connecting.
  const links = (await loadConnectorLinksMap([connector], ctx)).get(connector.id) ?? [];
  const link = options.linkId ? links.find((l) => l.id === options.linkId) : pickPrimaryLink(links);
  if (options.linkId && !link) throw new Error('Connector account no longer exists');
  connector = link
    ? withLinkCredentials(
        connector,
        await ensureFreshLinkToken(connector, link, getConnectorLinkModel(ctx), ctx.connectorModel),
      )
    : await ensureFreshConnectorToken(connector, ctx.connectorModel);

  const mcpParams = buildConnectorMcpParams(connector);

  const mcpApps = await isMcpAppsEnabled(ctx.userId);
  let rawTools: Awaited<ReturnType<typeof mcpService.listRawTools>>;
  try {
    // A server may list the tools only its views call just to a client
    // announcing MCP Apps; they are synced, and kept from the model, all the same
    rawTools =
      (await listOnDevice(connector, mcpParams, ctx, mcpApps)) ??
      (await mcpService.listRawTools(mcpParams, {
        mcpApps,
      }));
  } catch (err) {
    if (link) await getConnectorLinkModel(ctx).updateStatus(connectorId, link.id, 'error');
    if (links.length < 2) await ctx.connectorModel.updateStatus(connectorId, ConnectorStatus.error);
    throw err;
  }

  // Only an install holds the marketplace's policy. Any other sync (the
  // background refresh, a manual one, the OAuth callback) has the listing
  // alone, which cannot tell whether a manifest's `always` still holds: the
  // tools it marked mandatory stay so, or auto-run would skip their approval.
  const keptMandatory = options.humanInterventions
    ? new Set<string>()
    : new Set(
        (await ctx.connectorToolModel.queryByConnector(connectorId))
          .filter((tool) => hasMandatoryApproval(tool.metadata))
          .map((tool) => tool.toolName),
      );

  const syncInputs = rawTools.map((t) => {
    const humanIntervention = options.humanInterventions?.get(t.name);
    // Kept even for view-only tools: a view's call must find the tool synced,
    // while the manifest build leaves it out of the model's tool list.
    const metadata = withMandatoryApprovalMark(
      buildMcpToolMetadata(
        resolveMcpUiToolMeta(t._meta, false).visibility,
        mcpApps
          ? {
              ...resolveMcpUiToolMeta(t._meta),
              entrypoints: resolveMcpUiToolMeta(t._meta).entrypoints ?? [],
              threadEntry: getMcpAppEntrypoints([t], true)[0],
            }
          : undefined,
      ),
      humanIntervention,
    );
    return {
      crudType: inferCrudType(t.name),
      defaultPermission: resolveConnectorToolPermission(humanIntervention),
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown>,
      metadata: keptMandatory.has(t.name)
        ? { ...metadata, [MANDATORY_APPROVAL_KEY]: true }
        : metadata,
      toolName: t.name,
    };
  });

  await ctx.connectorToolModel.upsertMany(connectorId, syncInputs);
  if (options.pruneMissingAutoTools) {
    await pruneMissingAutoConnectorTools(
      ctx.connectorToolModel,
      connectorId,
      syncInputs.map((tool) => tool.toolName),
    );
  }
  if (link) await getConnectorLinkModel(ctx).updateStatus(connectorId, link.id, 'connected');
  await ctx.connectorModel.updateStatus(connectorId, ConnectorStatus.connected);

  return { toolCount: syncInputs.length };
};
