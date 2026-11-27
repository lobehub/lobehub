import { hasCallableMcpEndpoint, isMarketplaceInstallRunnable } from '@lobechat/const';
import { isSyncedMcpToolVisibleTo } from '@lobechat/const/mcpApp';
import type { LobeChatDatabase } from '@lobechat/database';
import type { McpElicitationCall } from '@lobechat/mcp-elicitation/types';
import {
  connectorIdentifierCandidates,
  getDisabledPluginIds,
  needsConnectorReauthorization,
} from '@lobechat/types';
import {
  connectorDeviceBinding,
  connectorMcpEndpoint,
  type McpDeviceBinding,
  shouldConnectViaDevice,
} from '@lobechat/utils/mcpEndpoint';

import type { AgentModel } from '@/database/models/agent';
import type { DecryptedConnector } from '@/database/models/connector';
import type { PluginModel } from '@/database/models/plugin';
import { ConnectorMcpConnectionType, ConnectorToolPermission } from '@/database/schemas';
import { deviceGateway } from '@/server/services/deviceGateway';
import { resolveMcpDeviceFeatures } from '@/server/services/deviceGateway/deviceChannels';
import type { FileService } from '@/server/services/file';
import { mcpService } from '@/server/services/mcp';
import { callCloudMcpTool, type CloudMcpCaller } from '@/server/services/mcp/cloudTool';
import { processContentBlocks } from '@/server/services/mcp/contentProcessor';
import {
  McpBoundDeviceUnavailableError,
  resolveBoundMcpDevice,
  toGatewayMcpParams,
} from '@/server/services/mcp/deviceTunnel';
import {
  getMcpParamsFingerprint,
  type McpRelayDevice,
  relayDeviceViewState,
} from '@/server/services/mcp/deviceView';
import { isMcpAppsEnabled } from '@/server/services/mcp/featureGate';
import { redisService } from '@/server/services/redis';
import type { McpRelayTargetEntry } from '@/server/services/redis/mcpDeviceRelay';
import {
  buildMcpAuthorizationErrorContent,
  isMcpAuthorizationError,
} from '@/server/services/toolExecution/mcpAuthError';

import type { McpElicitationService } from '../mcp/elicitation/McpElicitationService';
import { ConnectorLinkSelectionError, resolveLinkedCall } from './links';
import {
  buildLastSyncedAtMap,
  connectorSyncContextForRow,
  scheduleStaleConnectorToolsRefresh,
} from './refresh';
import { buildConnectorMcpParams, type ConnectorToolSyncContext } from './sync';
import { ensureFreshConnectorToken } from './tokens';

export type ConnectorToolCallErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'BAD_REQUEST'
  /** The device a bound connector runs on can't run it now (offline, gone, too old). */
  | 'PRECONDITION_FAILED';

/** Typed error so the tRPC layer can map to the right code and tests can assert. */
export class ConnectorToolCallError extends Error {
  readonly code: ConnectorToolCallErrorCode;

  constructor(code: ConnectorToolCallErrorCode, message: string) {
    super(message);
    this.name = 'ConnectorToolCallError';
    this.code = code;
  }
}

/** A finished connector tool call, as the Market's call report reads it. */
export interface ConnectorToolCallReport {
  errorCode?: string;
  errorMessage?: string;
  identifier: string;
  /** The connector's transport: `http` or `cloud`. */
  mcpType: string;
  meta: { sessionId?: string; version?: string };
  requestPayload: unknown;
  result?: unknown;
  startTime: number;
  success: boolean;
  toolName: string;
}

export type ConnectorToolCallReporter = (report: ConnectorToolCallReport) => void;

export interface ConnectorExecContext extends ConnectorToolSyncContext {
  /** Visibility-aware: decides whether the caller may act as the given agent. */
  agentModel: Pick<AgentModel, 'existsById' | 'getAgentConfigById'>;
  /**
   * The caller's legacy plugin rows, which stand in for an unmarked marketplace
   * install made before installs used connectors. None: no such row counts.
   */
  pluginModel?: Pick<PluginModel, 'findById'>;
  /**
   * Who a market-hosted (`cloud`) connector's tool runs as, resolved only for
   * such a call. `undefined` (or no resolver): no Market credential to run as.
   */
  resolveCloudMcpCaller?: () => Promise<CloudMcpCaller | undefined>;
  /**
   * The caller's file storage, read only for an HTTP connector call: a result's
   * image / audio blocks are stored as files the text result links to, as
   * `tools.mcp.callTool` does. `undefined` (or no resolver): the blocks are
   * formatted as returned (base64 data).
   */
  resolveFileService?: () => FileService | undefined;
  /**
   * Reports a marketplace MCP server's call to the Market, resolved only for
   * such a call. `undefined` (or no resolver): nothing is reported, e.g. the
   * user turned telemetry off.
   */
  resolveToolCallReporter?: () => Promise<ConnectorToolCallReporter | undefined>;
  /**
   * Finds the device a connector bound to one runs on. `undefined`: such a
   * connector's call fails instead of reaching the device.
   */
  serverDB?: LobeChatDatabase;
  /** `userId` decides the caller's `mcp_apps` flag. */
  userId?: string | null;
  /**
   * The workspace the call is made in. A view's device named by the caller
   * must be in the caller's own pool or this one, as a run's device is.
   */
  workspaceId?: string | null;
}

/**
 * The connector an identifier names. With an agent, resolve the way that agent's
 * runs do (agent-owned > mounted > free base row); without one, keep the base
 * lookup the classic chat path has always used (the workspace's shared rows).
 *
 * Agent-owned and mounted rows are scoped by workspace only, so in a workspace
 * another member's private agent would resolve to its connectors and their
 * credentials. Only an agent the caller can see may be resolved; any other id
 * reads as not found. A private agent's own private connectors also need the
 * call's `topicId` to be that agent's own topic (see `ConnectorRunTarget`).
 *
 * The one resolution every connector call runs on, including a desktop that
 * runs a stdio connector itself (`connector.getForRun`): which row serves a
 * conversation is decided here, never by the client.
 */
export const resolveConnectorForRun = async (
  params: {
    agentId?: string;
    /**
     * The tool prefix the call names (`connectorToolIdentifier`): a private or
     * personal row is a tool set of its own beside the shared row of its
     * connector, and only the row the prefix belongs to answers.
     */
    identifier: string;
    topicId?: string;
  },
  ctx: Pick<ConnectorExecContext, 'agentModel' | 'connectorModel'>,
) => {
  // Without an agent only shared rows resolve, each under its identifier
  if (!params.agentId)
    return (await ctx.connectorModel.queryByIdentifiers([params.identifier])).map((row) => ({
      ...row,
      toolIdentifier: row.identifier,
    }));
  if (!(await ctx.agentModel.existsById(params.agentId))) return [];

  const rows = await ctx.connectorModel.resolveToolSets(
    { agentId: params.agentId, topicId: params.topicId },
    connectorIdentifierCandidates(params.identifier),
  );
  const matches = rows.filter((row) => row.toolIdentifier === params.identifier);
  // Prefixes are collision-free within a run (`connectorToolIdentifier`); an
  // ambiguous one runs nothing rather than a guess at whose account
  return matches.length === 1 ? matches : [];
};

/**
 * An unfinished marketplace install (an interrupted reinstall, an OAuth
 * callback that connected after a cancel) must not run: its tool rows may not
 * match its endpoint. The same rule as tool discovery's.
 */
const assertInstallFinished = async (connector: DecryptedConnector, ctx: ConnectorExecContext) => {
  if (isMarketplaceInstallRunnable(connector, false)) return;
  const pluginRow = await ctx.pluginModel?.findById(connector.identifier);
  if (isMarketplaceInstallRunnable(connector, !!pluginRow)) return;

  throw new ConnectorToolCallError(
    'FORBIDDEN',
    `Connector '${connector.name}' has not finished installing. Install it again to use its tools.`,
  );
};

/**
 * Execute a single connector tool, enforcing the full permission model:
 * - the connector must exist and be enabled,
 * - the tool must exist in the synced tool list (no calling unsynced / forged
 *   tool names — they would otherwise be forwarded blindly to the remote MCP),
 * - the tool must not be disabled.
 *
 * Refreshes the OAuth token first, then calls the remote MCP with the decrypted
 * credentials. Shared by the `connector.callTool` tRPC procedure.
 */
/**
 * Whether a connector reaches `server` (`getMcpServerFingerprint`): an HTTP
 * one's URL and headers, or a stdio one's command, arguments and environment,
 * as its calls send them.
 */
const reachesServer = async (
  connector: DecryptedConnector,
  server: string | undefined,
): Promise<boolean> => {
  if (!server) return false;
  if (connector.mcpConnectionType === ConnectorMcpConnectionType.stdio) {
    if (!connector.mcpStdioConfig?.command) return false;
  } else if (!connector.mcpServerUrl) return false;
  const params = buildConnectorMcpParams(connector);
  if (params.type !== 'http' && params.type !== 'stdio') return false;

  return (await getMcpParamsFingerprint(params)) === server;
};

/** The device an MCP App view names (`relayDeviceId`), from the call's input. */
const viewDeviceOf = (params: {
  relayDeviceId?: string;
  relayWorkspaceId?: string;
}): McpRelayDevice | undefined =>
  params.relayDeviceId
    ? {
        deviceId: params.relayDeviceId,
        ...(params.relayWorkspaceId && { workspaceId: params.relayWorkspaceId }),
      }
    : undefined;

/**
 * The device a device-run connector's call goes to, and whether its client
 * serves MCP App views. A bound connector runs on its binding; a view's call
 * or read to an unbound one runs on the device the view came from
 * (`viewDevice`), never on one picked for it. A view from another device than
 * the binding names is refused: its server process lives elsewhere now.
 *
 * Either device is checked the way every bound call is (`resolveBoundMcpDevice`:
 * registered, visible to the caller in its pool, online, a client that runs
 * MCP). For a view (`cached`), the answer is kept for a few seconds per user,
 * connector and device: a view polls its tools far more often than that.
 */
const resolveConnectorDevice = async (
  connector: DecryptedConnector,
  {
    binding,
    cached,
    mcpApps,
    viewDevice,
  }: {
    binding?: McpDeviceBinding;
    cached: boolean;
    mcpApps: boolean;
    viewDevice?: McpRelayDevice;
  },
  ctx: ConnectorExecContext,
): Promise<McpRelayTargetEntry> => {
  const device = binding ?? viewDevice;
  if (!ctx.serverDB || !ctx.userId || !device) {
    throw new ConnectorToolCallError(
      'BAD_REQUEST',
      `Connector '${connector.name}' runs on a bound device, which this call can't reach.`,
    );
  }
  if (
    binding &&
    viewDevice &&
    (viewDevice.deviceId !== binding.deviceId ||
      (viewDevice.workspaceId ?? undefined) !== (binding.workspaceId ?? undefined))
  ) {
    throw new ConnectorToolCallError(
      'FORBIDDEN',
      'This view came from another device than the connector runs on now',
    );
  }
  // The device a caller names gets the connector's credentials, so it is held
  // to what a run of theirs may route to (`resolveMcpTunnelTarget`): their own
  // device, or one in the workspace the call is made in. Never another pool.
  if (!binding && viewDevice?.workspaceId && viewDevice.workspaceId !== ctx.workspaceId) {
    throw new ConnectorToolCallError(
      'FORBIDDEN',
      "This view came from a device outside your own devices and this workspace's",
    );
  }
  const { serverDB, userId } = ctx;

  const resolve = async (): Promise<McpRelayTargetEntry> => {
    const target = await resolveBoundMcpDevice({
      binding: device,
      identifier: connector.identifier,
      serverDB,
      userId,
    });
    const apps = mcpApps && (await resolveMcpDeviceFeatures(userId, target)).includes('apps');
    return { ...target, apps };
  };
  try {
    return cached
      ? await redisService.mcpDeviceRelay.rememberTarget(
          {
            connectorId: connector.id,
            deviceId: device.deviceId,
            userId,
            workspaceId: device.workspaceId,
          },
          resolve,
        )
      : await resolve();
  } catch (error) {
    if (error instanceof McpBoundDeviceUnavailableError) {
      throw new ConnectorToolCallError('PRECONDITION_FAILED', error.message);
    }
    throw error;
  }
};

const DEVICE_SERVES_NO_VIEWS =
  'The app on the device that runs this connector is too old to show interactive views. Update the desktop app or the `lh` CLI on that computer, then try again.';

/**
 * A failed call in the shape the chat stores as a tool error. The model reads
 * `content`; the tool card shows a failure only when `error` is set, so a bare
 * `success: false` would render as a successful call.
 */
const failedToolResult = (message: string, type: string) => ({
  content: message,
  error: { message, type },
  state: { content: [{ text: message, type: 'text' as const }], isError: true },
  success: false,
});

export const callConnectorToolById = async (
  params: {
    agentId?: string;
    args?: string;
    elicitation?: McpElicitationCall;
    /** An MCP App view's `tools/call`: only tools visible to the app run. */
    fromApp?: boolean;
    fromEntrypoint?: boolean;
    linkId?: string;
    identifier: string;
    /**
     * With `fromApp`: the device the view's result came from (`relayDeviceId`
     * on its `mcpApp`), in its pool, for a connector run on the user's device.
     */
    relayDeviceId?: string;
    relayWorkspaceId?: string;
    /** With `fromApp`: the server the view came from; its calls reach no other. */
    server?: string;
    toolName: string;
    /**
     * The conversation the call runs in, reported as the call's session. It also
     * decides whether a private agent's private connectors resolve; see
     * {@link resolveConnectorForRun}.
     */
    topicId?: string;
  },
  ctx: ConnectorExecContext & { mcpElicitationService?: McpElicitationService },
): Promise<unknown> => {
  const elicitation = params.elicitation;
  if (elicitation && ctx.mcpElicitationService) {
    if (
      elicitation.identity.identifier !== params.identifier ||
      elicitation.identity.apiName !== params.toolName
    )
      throw new ConnectorToolCallError('FORBIDDEN', 'MCP interaction identity mismatch');
    await ctx.mcpElicitationService.assertIdentity(elicitation.identity);
  }
  const [connector] = await resolveConnectorForRun(params, ctx);
  // The agent's configuration names the connector, not the row's tool prefix
  if (
    params.fromEntrypoint &&
    params.agentId &&
    getDisabledPluginIds(
      (await ctx.agentModel.getAgentConfigById(params.agentId))?.plugins ?? undefined,
    ).includes(connector?.identifier ?? params.identifier)
  )
    throw new ConnectorToolCallError('FORBIDDEN', 'This app is disabled for the agent');
  if (!connector) {
    throw new ConnectorToolCallError('NOT_FOUND', 'Connector not found');
  }
  if (!connector.isEnabled) {
    throw new ConnectorToolCallError('FORBIDDEN', 'Connector is disabled');
  }
  await assertInstallFinished(connector, ctx);
  // A view open since the connector was pointed elsewhere must not drive the new server
  if (params.fromApp && !(await reachesServer(connector, params.server))) {
    throw new ConnectorToolCallError(
      'FORBIDDEN',
      'This view came from another server than the connector reaches now',
    );
  }

  // The tool MUST be present in the synced list — this is the single source of
  // truth for what is callable. Unknown names (unsynced or hand-crafted) are
  // rejected before reaching the remote server.
  const mcpApps = await isMcpAppsEnabled(ctx.userId);
  const tools = await ctx.connectorToolModel.queryByConnector(connector.id);
  const tool = tools.find((t) => t.toolName === params.toolName);
  if (!tool) {
    throw new ConnectorToolCallError(
      'BAD_REQUEST',
      `Tool '${params.toolName}' is not available on this connector`,
    );
  }
  if (tool.permission === ConnectorToolPermission.disabled) {
    throw new ConnectorToolCallError(
      'FORBIDDEN',
      `Tool '${params.toolName}' is disabled for this connector`,
    );
  }
  // A view-only tool never enters the model's tool list; refuse a model call
  // that names it anyway.
  if (
    !params.fromEntrypoint &&
    !params.fromApp &&
    !isSyncedMcpToolVisibleTo(tool, 'model', mcpApps)
  ) {
    throw new ConnectorToolCallError(
      'FORBIDDEN',
      `Tool '${params.toolName}' can only be called from its interactive view`,
    );
  }

  // Keep the tool list fresh through normal use: if it hasn't been synced in a
  // while, refresh it from the upstream MCP server in the background so the user
  // never has to open the connector page and click Refresh by hand. HTTP-only,
  // throttled, and deferred — reuses the `tools` rows already loaded above.
  // Wrapped defensively: this is a pure optimization and must never break the
  // tool call, even if the scheduler itself throws.
  // A personal row a private agent's workspace run resolved refreshes through
  // its own scope (`connectorSyncContextForRow`).
  try {
    // A view relayed to a device polls many times a second; its connector's
    // other calls keep the tool list fresh
    const relayedViewCall =
      params.fromApp &&
      shouldConnectViaDevice(connectorMcpEndpoint(connector), {
        deviceGatewayConfigured: deviceGateway.isConfigured,
      });
    const refreshContext = relayedViewCall
      ? undefined
      : connectorSyncContextForRow(ctx, connector, ctx.serverDB);
    if (refreshContext) {
      scheduleStaleConnectorToolsRefresh(
        [
          {
            id: connector.id,
            mcpConnectionType: connector.mcpConnectionType,
            mcpServerUrl: connector.mcpServerUrl,
            metadata: connector.metadata,
          },
        ],
        buildLastSyncedAtMap(tools),
        { ...refreshContext, userId: ctx.userId },
      );
    }
  } catch {
    // Background tool-list refresh is best-effort — never fail the tool call.
  }

  // Stdio runs on the user's own device, never in the server process. HTTP set
  // to connect through the device, or a private one, also requires a device
  // when a gateway is configured; self-hosted servers without a gateway keep
  // connecting in-process. Same rule as agent runs (`ToolExecutionService`).
  if (
    shouldConnectViaDevice(connectorMcpEndpoint(connector), {
      deviceGatewayConfigured: deviceGateway.isConfigured,
    })
  ) {
    // A connector bound to a device runs there: the caller's client may be on
    // another machine (the web, or a desktop that isn't the bound one). A
    // view's call runs where its result came from: the binding, or the device
    // the view names.
    const binding = connectorDeviceBinding(connector);
    // An entrypoint opens with no result yet, so only a binding names its device
    const viewDevice = params.fromApp ? viewDeviceOf(params) : undefined;
    const viewCall = !!(params.fromApp || params.fromEntrypoint);
    if (deviceGateway.isConfigured && (binding || viewDevice)) {
      if (viewCall) assertDeviceViewCall(tool, params, mcpApps);
      return runConnectorToolOnDevice(
        connector,
        { binding, viewDevice },
        { ...params, mcpApps, schemas: tools.map((t) => t.inputSchema) },
        ctx,
      );
    }
    throw new ConnectorToolCallError(
      'BAD_REQUEST',
      `Connector '${connector.name}' connects through your own device (stdio, a local-network address, or set to "Connect via device"), so the server can't call it directly. ` +
        'Run these tools from a chat, with the desktop app or `lh connect` running on a computer that can reach this MCP server.',
    );
  }

  const report = await resolveReporter(connector, ctx);
  const run = { ...params, mcpApps, schemas: tools.map((t) => t.inputSchema) };
  if (!report) return runConnectorTool(connector, run, ctx);

  const startTime = Date.now();
  let failure: Error | undefined;
  let result: unknown;
  try {
    result = await runConnectorTool(connector, run, ctx);
    return result;
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
    throw error;
  } finally {
    report({
      errorCode: failure ? 'CALL_FAILED' : undefined,
      errorMessage: failure?.message,
      identifier: connector.identifier,
      mcpType: connector.mcpConnectionType ?? ConnectorMcpConnectionType.http,
      meta: { sessionId: params.topicId, version: installedVersion(connector.metadata) },
      requestPayload: params.args,
      result,
      startTime,
      success: !failure,
      toolName: params.toolName,
    });
  }
};

/**
 * The Market reporter for a marketplace MCP server's call, the way its plugin's
 * calls were reported (`tools.mcp.callTool`, `market.callCloudMcpEndpoint`).
 * Rows without an endpoint (Composio, skill projections) run elsewhere. A
 * reporter that can't be resolved never fails the call.
 */
const resolveReporter = async (connector: DecryptedConnector, ctx: ConnectorExecContext) => {
  if (connector.sourceType !== 'marketplace' || !hasCallableMcpEndpoint(connector)) return;
  try {
    return await ctx.resolveToolCallReporter?.();
  } catch {
    return undefined;
  }
};

/** The manifest version a marketplace install recorded. */
const installedVersion = (metadata: unknown): string | undefined => {
  const version = (metadata as { version?: unknown } | null)?.version;
  return typeof version === 'string' ? version : undefined;
};

interface ConnectorCallAccount {
  args?: string;
  fromApp?: boolean;
  linkId?: string;
  /** Input schemas of the connector's synced tools: they decide the selector's name. */
  schemas: readonly unknown[];
}

/**
 * The credentials and arguments a call runs with: the selected account's, the
 * selector stripped from the arguments, or the connector's own credentials. A
 * selection the model got wrong comes back as a failed tool result it can fix.
 */
const resolveCallAccount = async (
  connector: DecryptedConnector,
  params: ConnectorCallAccount,
  ctx: ConnectorExecContext,
): Promise<
  | { argsStr: string; failure?: undefined; fresh: DecryptedConnector; linkName?: string }
  | { failure: ReturnType<typeof failedToolResult> }
> => {
  try {
    const resolved = await resolveLinkedCall(
      {
        connector,
        argsStr: params.args,
        linkId: params.linkId,
        fromApp: params.fromApp,
        schemas: params.schemas,
      },
      ctx,
    );
    const fresh = resolved.linkId
      ? resolved.connector
      : await ensureFreshConnectorToken(connector, ctx.connectorModel);
    if (needsConnectorReauthorization(fresh.credentials)) {
      return {
        failure: failedToolResult(
          buildMcpAuthorizationErrorContent(connector.identifier, {
            isShareVisitor: false,
            linkName: resolved.linkName,
          }),
          'AUTHORIZATION_ERROR',
        ),
      };
    }
    return { argsStr: resolved.argsStr, fresh, linkName: resolved.linkName };
  } catch (error) {
    if (error instanceof ConnectorLinkSelectionError)
      return { failure: failedToolResult(error.message, 'CONNECTOR_ACCOUNT_SELECTION') };
    throw error;
  }
};

const runConnectorTool = async (
  connector: DecryptedConnector,
  params: ConnectorCallAccount & {
    elicitation?: McpElicitationCall;
    fromEntrypoint?: boolean;
    /** The caller's `mcp_apps` flag, as the call's checks read it. */
    mcpApps: boolean;
    toolName: string;
  },
  ctx: ConnectorExecContext & { mcpElicitationService?: McpElicitationService },
): Promise<unknown> => {
  // A market-hosted stdio server: no session to open, the market's cloud
  // gateway runs the tool by identifier.
  if (connector.mcpConnectionType === ConnectorMcpConnectionType.cloud) {
    const caller = await ctx.resolveCloudMcpCaller?.();
    if (!caller) {
      throw new ConnectorToolCallError(
        'FORBIDDEN',
        'User access token not found. Please sign in to Market first.',
      );
    }
    return callCloudMcpTool(
      { args: params.args, identifier: connector.identifier, toolName: params.toolName },
      caller,
    );
  }

  const account = await resolveCallAccount(connector, params, ctx);
  if (account.failure) return account.failure;
  // A view's call gets its blocks back as they are (`mcpService.callTool`)
  const fileService = params.fromApp ? undefined : ctx.resolveFileService?.();

  const elicitation = params.elicitation;
  const deadline = elicitation && Math.min(elicitation.deadline, Date.now() + 120_000);
  const service = ctx.mcpElicitationService;
  const host =
    elicitation && service && deadline
      ? service.createLegacyHost(elicitation.identity, deadline)
      : undefined;
  try {
    return await mcpService.callTool({
      ...(host &&
        deadline && {
          elicitation: {
            host,
            interactive: true,
            timeoutMs: Math.max(1, deadline - Date.now()),
            scope: JSON.stringify([service?.userId, service?.workspaceId]),
          },
        }),
      argsStr: account.argsStr,
      clientParams: buildConnectorMcpParams(account.fresh),
      fromApp: params.fromApp,
      fromEntrypoint: params.fromEntrypoint,
      mcpApps: params.mcpApps,
      processContentBlocks: fileService
        ? (blocks) => processContentBlocks(blocks, fileService)
        : undefined,
      toolName: params.toolName,
    });
  } catch (error) {
    if (isMcpAuthorizationError(error))
      return failedToolResult(
        buildMcpAuthorizationErrorContent(connector.identifier, {
          isShareVisitor: false,
          linkName: account.linkName,
        }),
        'AUTHORIZATION_ERROR',
      );
    throw error;
  }
};

/**
 * What a device is trusted to check for a view's call, checked here first:
 * an older client ignores the call's MCP Apps options and would run it as a
 * model call. A view reaches only app-visible tools, and a thread entrypoint
 * only a tool that declares one, while MCP Apps are on.
 */
const assertDeviceViewCall = (
  tool: { metadata?: Record<string, unknown> | null; toolName: string },
  params: { fromApp?: boolean; fromEntrypoint?: boolean },
  mcpApps: boolean,
) => {
  if (!mcpApps) throw new ConnectorToolCallError('FORBIDDEN', 'Interactive views are turned off');
  if (params.fromEntrypoint && !tool.metadata?.threadEntry) {
    throw new ConnectorToolCallError(
      'FORBIDDEN',
      'This tool does not declare an enabled thread entrypoint.',
    );
  }
  if (!params.fromEntrypoint && !isSyncedMcpToolVisibleTo(tool, 'app', mcpApps)) {
    throw new ConnectorToolCallError(
      'FORBIDDEN',
      `The tool "${tool.toolName}" can't be called from an interactive view.`,
    );
  }
};

/**
 * Run a device-run connector's tool on its device through the device gateway,
 * with the credentials its agent-run calls send (`buildConnectorMcpParams`,
 * token fields only): on its binding, or for a view's call on the device the
 * view came from (`resolveConnectorDevice`). Never moves to another device:
 * when that one can't run it, the call fails with the reason.
 *
 * On a client that serves MCP App views, the call runs with the MCP Apps
 * options (a view's media stays inline), and a result's view is kept for
 * relay back to that device (`relayDeviceViewState`).
 */
const runConnectorToolOnDevice = async (
  connector: DecryptedConnector,
  { binding, viewDevice }: { binding?: McpDeviceBinding; viewDevice?: McpRelayDevice },
  params: ConnectorCallAccount & {
    fromEntrypoint?: boolean;
    mcpApps: boolean;
    toolName: string;
  },
  ctx: ConnectorExecContext,
): Promise<unknown> => {
  const viewCall = !!(params.fromApp || params.fromEntrypoint);
  const target = await resolveConnectorDevice(
    connector,
    { binding, cached: viewCall, mcpApps: params.mcpApps, viewDevice },
    ctx,
  );
  if (viewCall && !target.apps) {
    throw new ConnectorToolCallError('PRECONDITION_FAILED', DEVICE_SERVES_NO_VIEWS);
  }

  const account = await resolveCallAccount(connector, params, ctx);
  if (account.failure) return account.failure;
  const connection = buildConnectorMcpParams(account.fresh);
  if (connection.type !== 'http' && connection.type !== 'stdio') {
    throw new ConnectorToolCallError(
      'BAD_REQUEST',
      `Connector '${connector.name}' can't run on a device`,
    );
  }
  const result = await deviceGateway.executeMcpCall({
    apiName: params.toolName,
    arguments: account.argsStr,
    clientKinds: target.clientKinds,
    deviceId: target.deviceId,
    identifier: connector.identifier,
    params: {
      ...toGatewayMcpParams(connection),
      ...(target.apps && {
        mcpCall: {
          ...(params.fromApp && { fromApp: true }),
          ...(params.fromEntrypoint && { fromEntrypoint: true }),
          mcpApps: true,
        },
      }),
    },
    userId: ctx.userId!,
    workspaceId: target.workspaceId,
  });

  const state = await relayDeviceViewState(result.state, {
    device: target,
    keep: target.apps,
    params: connection,
  });
  return {
    content: result.content,
    // A failure keeps its marker and structured details, as agent runs do
    ...(!result.success && {
      error: result.errorData ?? {
        code: 'MCP_DEVICE_EXECUTION_ERROR',
        message: result.error || result.content,
      },
    }),
    state: result.state ? state : undefined,
    success: result.success,
  };
};

/**
 * Read an MCP Apps `ui://` resource from a connector's server, so the chat can
 * render a connector tool result's interactive view. Same connector checks as
 * {@link callConnectorToolById}, minus the per-tool ones. Refused while the
 * `mcp_apps` flag is off, since the read opens a session that advertises MCP Apps.
 */
export const readConnectorUiResourceById = async (
  /** `server`: the server the result came from; the view is read from no other. */
  params: {
    agentId?: string;
    identifier: string;
    linkId?: string;
    /** For a connector run on the user's device: the device the result came from. */
    relayDeviceId?: string;
    relayWorkspaceId?: string;
    server: string;
    topicId?: string;
    uri: string;
  },
  ctx: ConnectorExecContext,
) => {
  if (!(await isMcpAppsEnabled(ctx.userId))) {
    throw new ConnectorToolCallError('FORBIDDEN', 'Interactive views are turned off');
  }

  const [connector] = await resolveConnectorForRun(params, ctx);
  if (!connector) {
    throw new ConnectorToolCallError('NOT_FOUND', 'Connector not found');
  }
  if (!connector.isEnabled) {
    throw new ConnectorToolCallError('FORBIDDEN', 'Connector is disabled');
  }
  await assertInstallFinished(connector, ctx);
  if (connector.mcpConnectionType === ConnectorMcpConnectionType.cloud) {
    throw new ConnectorToolCallError(
      'BAD_REQUEST',
      `Interactive views are not supported for ${connector.mcpConnectionType} connectors yet`,
    );
  }
  // A server run on the user's device (stdio, localhost / LAN, or set to
  // connect through the device) serves its view from there: from its binding,
  // or the device the result came from. Without either the chat falls back
  // to the plain result.
  const viaDevice = shouldConnectViaDevice(connectorMcpEndpoint(connector), {
    deviceGatewayConfigured: deviceGateway.isConfigured,
  });
  const binding = viaDevice ? connectorDeviceBinding(connector) : undefined;
  const viewDevice = viaDevice ? viewDeviceOf(params) : undefined;
  if (viaDevice && !(deviceGateway.isConfigured && (binding || viewDevice))) {
    throw new ConnectorToolCallError(
      'BAD_REQUEST',
      `Interactive views of connector '${connector.name}' are shown from the device that runs it, which this read doesn't name.`,
    );
  }

  // The identifier may name another server now (the connector was edited, or
  // the agent's copy replaced): its HTML must not get this result's data
  if (!(await reachesServer(connector, params.server))) {
    throw new ConnectorToolCallError(
      'NOT_FOUND',
      'This view came from another server than the connector reaches now',
    );
  }

  const target = viaDevice
    ? await resolveConnectorDevice(
        connector,
        { binding, cached: true, mcpApps: true, viewDevice },
        ctx,
      )
    : undefined;
  if (target && !target.apps) {
    throw new ConnectorToolCallError('PRECONDITION_FAILED', DEVICE_SERVES_NO_VIEWS);
  }

  const resolved = await resolveLinkedCall(
    { connector, linkId: params.linkId, fromApp: true },
    ctx,
  );
  const fresh = resolved.linkId
    ? resolved.connector
    : await ensureFreshConnectorToken(connector, ctx.connectorModel);
  const connection = buildConnectorMcpParams(fresh);

  if (!target) return mcpService.readUiResource(connection, params.uri);
  if (connection.type !== 'http' && connection.type !== 'stdio') {
    throw new ConnectorToolCallError(
      'BAD_REQUEST',
      `Connector '${connector.name}' can't run on a device`,
    );
  }
  return deviceGateway.readMcpUiResource({
    clientKinds: target.clientKinds,
    deviceId: target.deviceId,
    params: toGatewayMcpParams(connection),
    uri: params.uri,
    userId: ctx.userId!,
    workspaceId: target.workspaceId,
  });
};
