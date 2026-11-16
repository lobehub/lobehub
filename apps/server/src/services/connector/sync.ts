import {
  hasMandatoryApproval,
  MANDATORY_APPROVAL_KEY,
  marketplaceToolIntervention,
  marketplaceToolPoliciesOf,
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
import type { ConnectorLinkModel, DecryptedConnectorLink } from '@/database/models/connectorLink';
import type { ConnectorToolModel, SyncToolInput } from '@/database/models/connectorTool';
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
import { isWebhookEnabled } from '@/server/services/inboundWebhook/featureGate';
import { mcpService } from '@/server/services/mcp';
import { listMcpToolsOnDevice } from '@/server/services/mcp/deviceTunnel';
import { isMcpAppsEnabled } from '@/server/services/mcp/featureGate';

import { getConnectorLinkModel, resolveConnectorAccount } from './links';

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

type ConnectorToolWriteContext = {
  connectorModel: Pick<ConnectorModel, 'updateStatus'>;
  connectorToolModel: Pick<
    ConnectorToolModel,
    'deleteToolsNotIn' | 'queryByConnector' | 'upsertMany'
  >;
};

/**
 * Store the connector's tool sync inputs and mark it `connected`. A tool
 * synced before keeps the permission it has.
 */
export const writeConnectorToolSyncInputs = async (
  connectorId: string,
  syncInputs: SyncToolInput[],
  ctx: ConnectorToolWriteContext,
  options: ConnectorToolSyncOptions = {},
): Promise<{ toolCount: number }> => {
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

export interface ConnectorToolListOptions {
  /**
   * By tool name, the `humanIntervention` a marketplace manifest gives a tool
   * the server lists, which an MCP listing cannot carry (an HTTP marketplace
   * install). It applies as a client-listed tool's does in
   * `toClientToolSyncInputs`. Without it (a refresh), a synced tool keeps the
   * mandatory approval it has. Either way, market policies the connector
   * stores (`marketplaceToolPoliciesOf`) take precedence over it.
   */
  humanInterventions?: ReadonlyMap<string, unknown>;
  /** List with this account's credentials instead of the connector's primary one. */
  linkId?: string;
}

/** The OAuth account a listing ran as, which a sync marks with the outcome. */
export interface ConnectorToolListingAccount {
  /** The account listed as; none for a connector without accounts. */
  link?: DecryptedConnectorLink;
  /** The connector's accounts: with two or more, one account's failure leaves the connector's status as it is. */
  linkCount: number;
}

export interface ConnectorToolListing extends ConnectorToolListingAccount {
  /**
   * Whether the server offers MCP Events webhooks, when asked (the `webhook` flag is on). A
   * connector listed through a device never offers them: webhooks need a server the cloud reaches.
   */
  events?: { supported: boolean };
  syncInputs: SyncToolInput[];
}

/** The connector's metadata with the events capability a listing found, for the caller to store. */
export const withEventsCapability = <T extends Record<string, any> | null | undefined>(
  metadata: T,
  events: ConnectorToolListing['events'],
) =>
  events
    ? {
        ...metadata,
        capabilities: { ...metadata?.capabilities, events: { supported: events.supported } },
      }
    : metadata;

/**
 * Connect to a connector's MCP server and build the sync inputs of the tools
 * it lists, refreshing the OAuth token first when needed. Writes no tool and
 * no status: {@link syncConnectorToolsById} does, as does a caller that must
 * write them only while the row is still its own (a marketplace install).
 */
export const listConnectorToolSyncInputs = async (
  connectorId: string,
  /**
   * `userId` decides the `mcp_apps` flag: with it on, view-only tools are listed
   * too. `serverDB` finds the user's device for a connector the server can't
   * reach itself (`shouldConnectViaDevice`). Required, so each caller decides:
   * `undefined` fails such a listing instead of tunneling it to a device.
   */
  ctx: ConnectorToolSyncContext & {
    serverDB: LobeChatDatabase | undefined;
    userId?: string | null;
  },
  options: ConnectorToolListOptions & {
    /** Called when the server cannot be reached or refuses the listing, before it rethrows. */
    onListError?: (account: ConnectorToolListingAccount) => Promise<void>;
  } = {},
): Promise<ConnectorToolListing> => {
  let connector = await ctx.connectorModel.findById(connectorId);
  if (!connector) throw new Error('Connector not found');

  if (!connector.mcpServerUrl && connector.mcpConnectionType !== ConnectorMcpConnectionType.stdio) {
    throw new Error('Connector has no MCP server URL configured');
  }

  // Refresh the OAuth access token if it has expired before connecting.
  const account = await resolveConnectorAccount(connector, ctx, options.linkId);
  const { link } = account;
  connector = account.connector;

  const mcpParams = buildConnectorMcpParams(connector);

  const mcpApps = await isMcpAppsEnabled(ctx.userId);
  const mcpEvents = await isWebhookEnabled(ctx.userId);
  let rawTools: Awaited<ReturnType<typeof mcpService.listRawTools>>;
  let events: ConnectorToolListing['events'];
  try {
    // A server may list the tools only its views call just to a client
    // announcing MCP Apps; they are synced, and kept from the model, all the same
    const deviceTools = await listOnDevice(connector, mcpParams, ctx, mcpApps);
    rawTools = deviceTools ?? (await mcpService.listRawTools(mcpParams, { mcpApps, mcpEvents }));
    if (mcpEvents)
      // Event webhooks need a server the cloud reaches directly; a connector that runs
      // through a device never offers them, so it is not even asked.
      events = deviceTools
        ? { supported: false }
        : await mcpService.getEventsCapability(mcpParams, { mcpApps, mcpEvents });
  } catch (err) {
    await options.onListError?.({ link, linkCount: account.accountCount });
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

  // The market's per-tool policies, stored at the install, decide every sync:
  // a declared tool the server only lists later keeps its policy, and one the
  // market never declared (added since, or renamed) gets no auto-run
  const marketPolicies = marketplaceToolPoliciesOf(connector.metadata);

  const syncInputs = rawTools.map((t) => {
    const humanIntervention = marketplaceToolIntervention(
      marketPolicies,
      t.name,
      options.humanInterventions?.get(t.name),
    );
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

  return { events, link, linkCount: account.accountCount, syncInputs };
};

/**
 * Connect to a connector's MCP server, fetch its tool list, and sync it into
 * `user_connector_tools`. Refreshes the OAuth token first when needed, and
 * updates the connector status (`connected` on success, `error` on failure),
 * and that of the account it listed as.
 *
 * Shared by the `syncTools` tRPC mutation and the OAuth callback so a connector
 * has its tools immediately after authorization — no client round-trip needed.
 */
export const syncConnectorToolsById = async (
  connectorId: string,
  /** As {@link listConnectorToolSyncInputs} takes it. */
  ctx: ConnectorToolSyncContext & {
    serverDB: LobeChatDatabase | undefined;
    userId?: string | null;
  },
  options: ConnectorToolSyncOptions & ConnectorToolListOptions = {},
): Promise<{ toolCount: number }> => {
  const { pruneMissingAutoTools, ...listOptions } = options;
  const { events, link, syncInputs } = await listConnectorToolSyncInputs(connectorId, ctx, {
    ...listOptions,
    onListError: async (account) => {
      if (account.link)
        await getConnectorLinkModel(ctx).updateStatus(connectorId, account.link.id, 'error');
      if (account.linkCount < 2)
        await ctx.connectorModel.updateStatus(connectorId, ConnectorStatus.error);
    },
  });
  if (events) {
    const current = await ctx.connectorModel.findById(connectorId);
    if (current)
      await ctx.connectorModel.update(connectorId, {
        metadata: withEventsCapability(current.metadata, events),
      });
  }
  const result = await writeConnectorToolSyncInputs(connectorId, syncInputs, ctx, {
    pruneMissingAutoTools,
  });
  if (link) await getConnectorLinkModel(ctx).updateStatus(connectorId, link.id, 'connected');
  return result;
};
