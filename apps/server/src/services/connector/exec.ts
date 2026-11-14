import { hasCallableMcpEndpoint, isMarketplaceInstallRunnable } from '@lobechat/const';
import { getMcpServerFingerprint, isSyncedMcpToolVisibleTo } from '@lobechat/const/mcpApp';
import { isLocalOrPrivateUrl } from '@lobechat/utils';

import type { AgentModel } from '@/database/models/agent';
import type { DecryptedConnector } from '@/database/models/connector';
import type { PluginModel } from '@/database/models/plugin';
import { ConnectorMcpConnectionType, ConnectorToolPermission } from '@/database/schemas';
import { deviceGateway } from '@/server/services/deviceGateway';
import type { FileService } from '@/server/services/file';
import { mcpService } from '@/server/services/mcp';
import { callCloudMcpTool, type CloudMcpCaller } from '@/server/services/mcp/cloudTool';
import { processContentBlocks } from '@/server/services/mcp/contentProcessor';
import { isMcpAppsEnabled } from '@/server/services/mcp/featureGate';

import { buildLastSyncedAtMap, scheduleStaleConnectorToolsRefresh } from './refresh';
import { buildConnectorMcpParams, type ConnectorToolSyncContext } from './sync';
import { ensureFreshConnectorToken } from './tokens';

export type ConnectorToolCallErrorCode = 'NOT_FOUND' | 'FORBIDDEN' | 'BAD_REQUEST';

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
  agentModel: Pick<AgentModel, 'existsById'>;
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
  /** `userId` decides the caller's `mcp_apps` flag. */
  userId?: string | null;
}

/**
 * The connector an identifier names. With an agent, resolve the way that agent's
 * runs do (agent-owned > mounted > free base row); without one, keep the base
 * lookup the classic chat path has always used.
 *
 * Connector rows are scoped by workspace only, so in a workspace another
 * member's private agent would resolve to its connectors and their
 * credentials. Only an agent the caller can see may be resolved; any other id
 * reads as not found.
 */
const findConnector = async (
  params: { agentId?: string; identifier: string },
  ctx: ConnectorExecContext,
) => {
  if (!params.agentId) return ctx.connectorModel.queryByIdentifiers([params.identifier]);
  if (!(await ctx.agentModel.existsById(params.agentId))) return [];

  return ctx.connectorModel.resolveByIdentifiers([params.identifier], params.agentId);
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
 * Whether an HTTP connector reaches `server` (`getMcpServerFingerprint`): its
 * URL and headers as its calls send them.
 */
const reachesServer = async (
  connector: DecryptedConnector,
  server: string | undefined,
): Promise<boolean> => {
  if (!server || !connector.mcpServerUrl) return false;
  const params = buildConnectorMcpParams(connector);
  if (params.type !== 'http') return false;

  return (
    (await getMcpServerFingerprint({ headers: params.headers, type: 'http', url: params.url })) ===
    server
  );
};

export const callConnectorToolById = async (
  params: {
    agentId?: string;
    args?: string;
    /** An MCP App view's `tools/call`: only tools visible to the app run. */
    fromApp?: boolean;
    identifier: string;
    /** With `fromApp`: the server the view came from; its calls reach no other. */
    server?: string;
    toolName: string;
    /** The conversation the call runs in, reported as the call's session. */
    topicId?: string;
  },
  ctx: ConnectorExecContext,
): Promise<unknown> => {
  const [connector] = await findConnector(params, ctx);
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
  if (!params.fromApp && !isSyncedMcpToolVisibleTo(tool, 'model')) {
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
  try {
    scheduleStaleConnectorToolsRefresh(
      [
        {
          id: connector.id,
          mcpConnectionType: connector.mcpConnectionType,
          mcpServerUrl: connector.mcpServerUrl,
        },
      ],
      buildLastSyncedAtMap(tools),
      ctx,
    );
  } catch {
    // Background tool-list refresh is best-effort — never fail the tool call.
  }

  // Stdio runs on a desktop device, never in the server process. Private HTTP
  // endpoints also require a device when a gateway is configured; self-hosted
  // servers without a gateway can still connect to their own LAN over HTTP.
  const requiresDevice =
    connector.mcpConnectionType === ConnectorMcpConnectionType.stdio ||
    (deviceGateway.isConfigured &&
      !!connector.mcpServerUrl &&
      isLocalOrPrivateUrl(connector.mcpServerUrl));
  if (requiresDevice) {
    throw new ConnectorToolCallError(
      'BAD_REQUEST',
      `Connector '${connector.name}' points at an MCP endpoint that only your machine can reach (stdio or local network). ` +
        'Run these tools in the desktop app through a configured device gateway.',
    );
  }

  const report = await resolveReporter(connector, ctx);
  if (!report) return runConnectorTool(connector, params, ctx);

  const startTime = Date.now();
  let failure: Error | undefined;
  let result: unknown;
  try {
    result = await runConnectorTool(connector, params, ctx);
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

const runConnectorTool = async (
  connector: DecryptedConnector,
  params: { args?: string; fromApp?: boolean; toolName: string },
  ctx: ConnectorExecContext,
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

  const fresh = await ensureFreshConnectorToken(connector, ctx.connectorModel);
  // A view's call gets its blocks back as they are (`mcpService.callTool`)
  const fileService = params.fromApp ? undefined : ctx.resolveFileService?.();

  return mcpService.callTool({
    argsStr: params.args ?? '{}',
    clientParams: buildConnectorMcpParams(fresh),
    fromApp: params.fromApp,
    mcpApps: await isMcpAppsEnabled(ctx.userId),
    processContentBlocks: fileService
      ? (blocks) => processContentBlocks(blocks, fileService)
      : undefined,
    toolName: params.toolName,
  });
};

/**
 * Read an MCP Apps `ui://` resource from a connector's server, so the chat can
 * render a connector tool result's interactive view. Same connector checks as
 * {@link callConnectorToolById}, minus the per-tool ones. Refused while the
 * `mcp_apps` flag is off, since the read opens a session that advertises MCP Apps.
 */
export const readConnectorUiResourceById = async (
  /** `server`: the server the result came from; the view is read from no other. */
  params: { agentId?: string; identifier: string; server: string; uri: string },
  ctx: ConnectorExecContext,
) => {
  if (!(await isMcpAppsEnabled(ctx.userId))) {
    throw new ConnectorToolCallError('FORBIDDEN', 'Interactive views are turned off');
  }

  const [connector] = await findConnector(params, ctx);
  if (!connector) {
    throw new ConnectorToolCallError('NOT_FOUND', 'Connector not found');
  }
  if (!connector.isEnabled) {
    throw new ConnectorToolCallError('FORBIDDEN', 'Connector is disabled');
  }
  await assertInstallFinished(connector, ctx);
  if (
    connector.mcpConnectionType === ConnectorMcpConnectionType.stdio ||
    connector.mcpConnectionType === ConnectorMcpConnectionType.cloud
  ) {
    throw new ConnectorToolCallError(
      'BAD_REQUEST',
      `Interactive views are not supported for ${connector.mcpConnectionType} connectors yet`,
    );
  }
  // A cloud server can't reach a localhost / LAN endpoint, and resource reads
  // aren't tunneled to the device yet; the chat falls back to the plain result.
  if (
    deviceGateway.isConfigured &&
    !!connector.mcpServerUrl &&
    isLocalOrPrivateUrl(connector.mcpServerUrl)
  ) {
    throw new ConnectorToolCallError(
      'BAD_REQUEST',
      'Interactive views are not supported for local-network connectors yet',
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

  const fresh = await ensureFreshConnectorToken(connector, ctx.connectorModel);

  return mcpService.readUiResource(buildConnectorMcpParams(fresh), params.uri);
};
