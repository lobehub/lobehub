import { randomUUID } from 'node:crypto';
import os from 'node:os';

import { OFFICIAL_DEVICE_GATEWAY_URL } from '@lobechat/const/url';
import type {
  EnrollWorkspaceParams,
  EnrollWorkspaceResult,
  UnenrollWorkspaceParams,
} from '@lobechat/device-control';
import type {
  AgentRunRequestMessage,
  GatewayMcpStdioParams,
  MessageApiRequestMessage,
  RpcRequestMessage,
  SystemInfoRequestMessage,
  ToolCallRequestMessage,
  ToolCallResponseMessage,
} from '@lobechat/device-gateway-client';
import { GatewayClient } from '@lobechat/device-gateway-client';
import type { IdentitySource } from '@lobechat/device-identity';
import { deriveDeviceId, deriveScopedFallbackId } from '@lobechat/device-identity';
import type { GatewayConnectionStatus } from '@lobechat/electron-client-ipc';
import { app, powerSaveBlocker } from 'electron';

import { isDev } from '@/const/env';
import { getDesktopEnv } from '@/env';
import { createLogger } from '@/utils/logger';
import { getDesktopUserAgent } from '@/utils/user-agent';

import { ServiceModule } from './index';

const logger = createLogger('services:GatewayConnectionSrv');

const DEFAULT_GATEWAY_URL = OFFICIAL_DEVICE_GATEWAY_URL;

/**
 * Result envelope a tool-call handler must return. Mirrors
 * `BuiltinServerRuntimeOutput` so the renderer-side and remote-device paths
 * stay symmetric: `content` is the LLM-facing prompt text; `state` carries the
 * structured payload that downstream persists into `pluginState`.
 */
interface ToolCallResult {
  content: string;
  error?: unknown;
  state?: unknown;
  success: boolean;
}

interface MessageApiHandler {
  (platform: string, apiName: string, payload: Record<string, unknown>): Promise<unknown>;
}

interface ToolCallHandler {
  (identifier: string | undefined, apiName: string, args: unknown): Promise<ToolCallResult>;
}

/**
 * Handler for tunneled stdio MCP calls. Unlike {@link ToolCallHandler} (which
 * keys on `apiName` for builtin local-system tools), this carries the MCP
 * server identity + connection params so the device can spawn the local stdio
 * server and invoke the tool on it.
 */
interface McpCallHandler {
  (mcpCall: {
    apiName: string;
    arguments: string;
    identifier: string;
    params: GatewayMcpStdioParams;
  }): Promise<ToolCallResult>;
}

/**
 * Coerce a runtime error (which may be an Error, string, or `{ message }`
 * object) into the string shape the wire protocol expects. Returns undefined
 * when there's no error to transmit.
 */
const serializeWireError = (err: unknown): string | undefined => {
  if (err === undefined || err === null) return undefined;
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
    return err.message;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
};

interface AgentRunHandler {
  (request: AgentRunRequestMessage): Promise<{ reason?: string; status: 'accepted' | 'rejected' }>;
}

/**
 * Handler for generic server-internal device RPCs (e.g. workspace-init scans).
 * Dispatches by `method` name and returns the JSON-serializable result. Distinct
 * from {@link ToolCallHandler} — RPCs are never exposed to the agent.
 */
interface RpcHandler {
  (method: string, params: unknown): Promise<unknown>;
}

interface DeviceRegistrar {
  (info: {
    deviceId: string;
    hostname: string;
    identitySource: IdentitySource;
    platform: string;
  }): Promise<void>;
}

/**
 * Mint a fresh workspace-device connect token for a share connection. Injected
 * by the controller (which owns the authed server URL + user token) — used when
 * restoring persisted enrollments on startup and when a workspace connection's
 * token expires. Returns null when the desktop is not in a state to mint (e.g.
 * logged out).
 */
interface WorkspaceTokenProvider {
  (workspaceId: string): Promise<string | null>;
}

/**
 * Check whether the workspace-scoped deviceId still has a registered row on the
 * server. Returns `false` only on a definitive "row gone" answer (share revoked
 * while offline); `undefined` when the check could not be performed — callers
 * must NOT clear local state on `undefined`.
 */
interface WorkspaceDeviceChecker {
  (workspaceId: string, deviceId: string): Promise<boolean | undefined>;
}

/**
 * GatewayConnectionService
 *
 * Core business logic for managing WebSocket connection to the cloud device-gateway.
 * Extracted from GatewayConnectionCtr so other controllers can reuse connect/disconnect.
 */
export default class GatewayConnectionService extends ServiceModule {
  private client: GatewayClient | null = null;
  private status: GatewayConnectionStatus = 'disconnected';
  private deviceId: string | null = null;
  private powerSaveBlockerId: number | null = null;

  private identitySource: IdentitySource | null = null;

  private tokenProvider: (() => Promise<string | null>) | null = null;
  private tokenRefresher: (() => Promise<{ error?: string; success: boolean }>) | null = null;
  private toolCallHandler: ToolCallHandler | null = null;
  private mcpCallHandler: McpCallHandler | null = null;
  private messageApiHandler: MessageApiHandler | null = null;
  private agentRunHandler: AgentRunHandler | null = null;
  private rpcHandler: RpcHandler | null = null;
  private deviceRegistrar: DeviceRegistrar | null = null;
  private workspaceTokenProvider: WorkspaceTokenProvider | null = null;
  private workspaceDeviceChecker: WorkspaceDeviceChecker | null = null;

  /** Live workspace-share connections, keyed by workspaceId. */
  private workspaceClients = new Map<string, GatewayClient>();
  /** Serializes enrollment restores so reconnect churn can't double-open sockets. */
  private workspaceRestoreInFlight = false;

  // ─── Configuration ───

  /**
   * Set token provider function (to decouple from RemoteServerConfigCtr)
   */
  setTokenProvider(provider: () => Promise<string | null>) {
    this.tokenProvider = provider;
  }

  /**
   * Set token refresher function (for auth_expired handling)
   */
  setTokenRefresher(refresher: () => Promise<{ error?: string; success: boolean }>) {
    this.tokenRefresher = refresher;
  }

  /**
   * Set tool call handler (to route tool calls to LocalFileCtr/ShellCommandCtr)
   */
  setToolCallHandler(handler: ToolCallHandler) {
    this.toolCallHandler = handler;
  }

  /**
   * Set the MCP call handler (routes tunneled stdio MCP calls to McpCtr, which
   * spawns the local stdio server). Distinct from the builtin tool-call handler.
   */
  setMcpCallHandler(handler: McpCallHandler) {
    this.mcpCallHandler = handler;
  }

  setMessageApiHandler(handler: MessageApiHandler) {
    this.messageApiHandler = handler;
  }

  /**
   * Set the generic device-RPC handler (routes server-internal method calls such
   * as workspace-init to the relevant controller). Distinct from the tool-call
   * handler — these are never surfaced to the agent.
   */
  setRpcHandler(handler: RpcHandler) {
    this.rpcHandler = handler;
  }

  setAgentRunHandler(handler: AgentRunHandler) {
    this.agentRunHandler = handler;
  }

  /**
   * Persist this device to the server's device registry. Called on every
   * connect once the userId is known (deviceId is user-scoped). Injected by the
   * controller, which owns the authed server URL + token.
   */
  setDeviceRegistrar(registrar: DeviceRegistrar) {
    this.deviceRegistrar = registrar;
  }

  /**
   * Set the workspace connect-token minter used by share connections (startup
   * restore + token expiry). Injected by the controller, which owns the authed
   * server calls.
   */
  setWorkspaceTokenProvider(provider: WorkspaceTokenProvider) {
    this.workspaceTokenProvider = provider;
  }

  /**
   * Set the "is this workspace device row still registered?" probe used before
   * restoring a persisted enrollment, so a share revoked while the app was
   * offline doesn't come back as a ghost device.
   */
  setWorkspaceDeviceChecker(checker: WorkspaceDeviceChecker) {
    this.workspaceDeviceChecker = checker;
  }

  // ─── Device ID ───

  /**
   * Ensure a stored fallback id exists. Pre-login this doubles as the device id
   * shown by `getDeviceInfo`; once a userId is available `resolveDeviceIdentity`
   * replaces it with a stable machine-derived id.
   */
  loadOrCreateDeviceId() {
    const stored = this.app.storeManager.get('gatewayDeviceId') as string | undefined;
    if (stored) {
      this.deviceId = stored;
    } else {
      this.deviceId = randomUUID();
      this.app.storeManager.set('gatewayDeviceId', this.deviceId);
    }
    logger.debug(`Device ID: ${this.deviceId}`);
  }

  /**
   * Derive the stable, user-scoped device id. Survives LobeHub reinstalls
   * because it hashes the OS machine id; falls back to the stored random UUID
   * when the machine id is unavailable. Caches the result for this session.
   */
  resolveDeviceIdentity(userId: string): { deviceId: string; identitySource: IdentitySource } {
    const fallbackId = this.app.storeManager.get('gatewayDeviceId') as string | undefined;
    const identity = deriveDeviceId(userId, { fallbackId });
    this.deviceId = identity.deviceId;
    this.identitySource = identity.identitySource;
    return identity;
  }

  getDeviceId(): string {
    return this.deviceId || 'unknown';
  }

  /**
   * Connection routing key — the gateway's stale-socket dedupe key, decoupled
   * from the stable `deviceId`. Reuses the persisted random UUID (historically
   * `gatewayDeviceId`, now used purely as the connectionId) so a reconnect of
   * this install replaces only its own previous socket, while a co-running
   * `lh connect` on the same machine (same deviceId, different connectionId)
   * stays connected.
   */
  getConnectionId(): string {
    let id = this.app.storeManager.get('gatewayDeviceId') as string | undefined;
    if (!id) {
      id = randomUUID();
      this.app.storeManager.set('gatewayDeviceId', id);
    }
    return id;
  }

  // ─── Connection Status ───

  getStatus(): GatewayConnectionStatus {
    return this.status;
  }

  getDeviceInfo() {
    return {
      description: this.getDeviceDescription(),
      deviceId: this.getDeviceId(),
      hostname: os.hostname(),
      name: this.getDeviceName(),
      platform: process.platform,
    };
  }

  // ─── Device Name & Description ───

  getDeviceName(): string {
    return (this.app.storeManager.get('gatewayDeviceName') as string) || os.hostname();
  }

  setDeviceName(name: string) {
    this.app.storeManager.set('gatewayDeviceName', name);
  }

  getDeviceDescription(): string {
    return (this.app.storeManager.get('gatewayDeviceDescription') as string) || '';
  }

  setDeviceDescription(description: string) {
    this.app.storeManager.set('gatewayDeviceDescription', description);
  }

  // ─── Connection Logic ───

  async connect(): Promise<{ error?: string; success: boolean }> {
    if (this.status === 'connected' || this.status === 'connecting') {
      return { success: true };
    }
    return this.doConnect();
  }

  async disconnect(): Promise<{ success: boolean }> {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }
    // Take the workspace share connections down with the personal one (the
    // device goes fully offline), but keep the persisted enrollments — the next
    // connect restores them.
    for (const workspaceId of this.workspaceClients.keys()) {
      await this.closeWorkspaceClient(workspaceId);
    }
    this.setStatus('disconnected');
    return { success: true };
  }

  private async doConnect(): Promise<{ error?: string; success: boolean }> {
    // Clean up any existing client
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }

    if (!this.tokenProvider) {
      logger.warn('Cannot connect: no token provider configured');
      return { error: 'No token provider configured', success: false };
    }

    const token = await this.tokenProvider();
    if (!token) {
      logger.warn('Cannot connect: no access token');
      return { error: 'No access token available', success: false };
    }

    const gatewayUrl = this.getGatewayUrl();
    const userId = this.extractUserIdFromToken(token);
    logger.info(`Connecting to device gateway: ${gatewayUrl}, userId: ${userId || 'unknown'}`);

    // Resolve the stable, user-scoped device id and register with the server
    // registry before opening the WS, so the device row exists by the time the
    // gateway reports it online.
    if (userId) {
      const identity = this.resolveDeviceIdentity(userId);
      await this.deviceRegistrar?.({
        deviceId: identity.deviceId,
        hostname: os.hostname(),
        identitySource: identity.identitySource,
        platform: process.platform,
      }).catch((err) => {
        logger.warn(`Device registration failed (non-fatal): ${(err as Error).message}`);
      });
    }

    const client = new GatewayClient({
      channel: isDev ? 'desktop-dev' : 'desktop',
      connectionId: this.getConnectionId(),
      deviceId: this.getDeviceId(),
      gatewayUrl,
      logger,
      token,
      userAgent: getDesktopUserAgent(),
      userId: userId || undefined,
    });

    this.setupClientEvents(client);
    this.client = client;

    await client.connect();

    // Re-open persisted workspace share connections once the personal
    // connection is up. Fire-and-forget: restore failures must never block or
    // fail the personal connect.
    void this.restoreWorkspaceEnrollments().catch((err) => {
      logger.warn('Workspace enrollment restore failed (non-fatal):', err);
    });

    return { success: true };
  }

  /**
   * Bind the shared request handlers. All request routing (tool calls / RPCs /
   * agent runs / system info) is identical for the personal connection and a
   * workspace share connection; only connection lifecycle differs — a workspace
   * scope skips global status broadcasting and refreshes its token by
   * re-minting a workspace connect token instead of refreshing the user token.
   */
  private setupClientEvents(client: GatewayClient, scope?: { workspaceId: string }) {
    if (scope) {
      client.on('status_changed', (status) => {
        logger.info(`Workspace ${scope.workspaceId} connection status: ${status}`);
      });
    } else {
      client.on('status_changed', (status) => {
        this.setStatus(status);
      });
    }

    client.on('tool_call_request', (request) => {
      this.handleToolCallRequest(request, client);
    });

    client.on('message_api_request', (request) => {
      this.handleMessageApiRequest(request, client);
    });

    client.on('system_info_request', (request) => {
      this.handleSystemInfoRequest(client, request);
    });

    client.on('rpc_request', (request) => {
      this.handleRpcRequest(client, request);
    });

    client.on('agent_run_request', (request) => {
      this.handleAgentRunRequest(client, request);
    });

    client.on('auth_expired', () => {
      if (scope) {
        logger.warn(`Workspace ${scope.workspaceId} connect token expired, re-minting`);
        void this.handleWorkspaceAuthExpired(scope.workspaceId);
      } else {
        logger.warn('Received auth_expired, will reconnect with refreshed token');
        this.handleAuthExpired();
      }
    });

    client.on('error', (error) => {
      logger.error('WebSocket error:', error.message);
    });
  }

  // ─── Workspace Share Connections ───
  //
  // The server shares this personal device into a workspace by sending an
  // `enrollWorkspace` RPC over the personal connection. The app then keeps a
  // second gateway connection per shared workspace — authenticated with a
  // short-lived workspace-device connect token and identified by the
  // workspace-derived deviceId — so the machine is simultaneously reachable as
  // a personal device and as a device of each shared workspace.

  /**
   * Handle the `enrollWorkspace` device RPC: open the share connection and
   * persist the enrollment, returning the derived identity so the SERVER can
   * register the workspace device row (the desktop never calls
   * `registerWorkspaceDevice` itself on this path).
   */
  async enrollWorkspace(params: EnrollWorkspaceParams): Promise<EnrollWorkspaceResult> {
    // Dry-run probe: return the derived identity so the server can detect an
    // existing enrollment (and ask for overwrite confirmation) without this
    // machine opening or persisting anything.
    if (params.identityOnly) return this.resolveWorkspaceDeviceIdentity(params.workspaceId);
    const identity = await this.openWorkspaceClient(params.workspaceId, params.token);
    this.persistWorkspaceEnrollment(params.workspaceId);
    logger.info(`Enrolled into workspace ${params.workspaceId} as device ${identity.deviceId}`);
    return identity;
  }

  /**
   * Handle the `unenrollWorkspace` device RPC (share revoked): close the share
   * connection and drop the persisted auto-reconnect state. The instruction may
   * arrive on the workspace connection or the personal one — both route here.
   */
  async unenrollWorkspace(params: UnenrollWorkspaceParams): Promise<{ success: boolean }> {
    await this.closeWorkspaceClient(params.workspaceId);
    this.removePersistedWorkspaceEnrollment(params.workspaceId);
    logger.info(`Unenrolled from workspace ${params.workspaceId}`);
    return { success: true };
  }

  /**
   * Identity for a WORKSPACE share connection. MUST stay byte-compatible with
   * the CLI's `resolveWorkspaceDeviceIdentity` (apps/cli/src/device/register.ts):
   * both hash the `workspace:<id>` principal, so the same physical machine
   * enrolled into a workspace — via desktop share or `lh connect --workspace` —
   * resolves to one workspace device.
   */
  private resolveWorkspaceDeviceIdentity(workspaceId: string): EnrollWorkspaceResult {
    // Fallback machines (no readable machine id) must still derive a STABLE
    // workspace id — the identity-only probe, the real enroll, and restore
    // checks each re-derive it. Namespace the persisted install UUID rather
    // than passing it raw: the raw UUID IS the personal deviceId on fallback
    // machines, and reusing it here would collide the two pools.
    const storedFallback = this.app.storeManager.get('gatewayDeviceId') as string | undefined;
    return deriveDeviceId(`workspace:${workspaceId}`, {
      fallbackId: storedFallback
        ? deriveScopedFallbackId(storedFallback, `workspace:${workspaceId}`)
        : undefined,
    });
  }

  private async openWorkspaceClient(
    workspaceId: string,
    token: string,
  ): Promise<EnrollWorkspaceResult> {
    // Re-enroll replaces the previous share connection instead of stacking one.
    await this.closeWorkspaceClient(workspaceId);

    const identity = this.resolveWorkspaceDeviceIdentity(workspaceId);

    const client = new GatewayClient({
      channel: isDev ? 'desktop-dev' : 'desktop',
      // Reuse the install's connectionId: the gateway dedupes stale sockets per
      // principal, so the workspace connection only ever replaces its own
      // predecessor, never the personal socket.
      connectionId: this.getConnectionId(),
      deviceId: identity.deviceId,
      gatewayUrl: this.getGatewayUrl(),
      logger,
      token,
      userAgent: getDesktopUserAgent(),
      userId: undefined,
      workspaceId,
    });

    this.setupClientEvents(client, { workspaceId });
    this.workspaceClients.set(workspaceId, client);

    await client.connect();
    return identity;
  }

  private async closeWorkspaceClient(workspaceId: string) {
    const client = this.workspaceClients.get(workspaceId);
    if (!client) return;
    this.workspaceClients.delete(workspaceId);
    await client.disconnect();
  }

  /**
   * Workspace share connections authenticate with a short-lived minted token,
   * not the user token — on expiry, re-mint via the injected provider and
   * reconnect in place. A failed re-mint (share/membership likely revoked)
   * closes the socket but keeps the persisted enrollment: the next startup's
   * restore path settles it against the server row.
   */
  private async handleWorkspaceAuthExpired(workspaceId: string) {
    const client = this.workspaceClients.get(workspaceId);
    if (!client) return;

    try {
      const token = await this.workspaceTokenProvider?.(workspaceId);
      if (!token) throw new Error('no workspace connect token available');
      client.updateToken(token);
      await client.reconnect();
    } catch (error) {
      logger.warn(`Workspace ${workspaceId} token re-mint failed, closing share:`, error);
      await this.closeWorkspaceClient(workspaceId);
    }
  }

  /**
   * Re-open share connections persisted by a previous run. Before reconnecting,
   * confirm the derived workspace deviceId still has a registered row — the
   * share may have been revoked while the app was offline (the server can't
   * deliver `unenrollWorkspace` to a dead socket), and reconnecting anyway
   * would resurrect the device as a ghost in the workspace pool.
   */
  private async restoreWorkspaceEnrollments() {
    if (this.workspaceRestoreInFlight) return;
    this.workspaceRestoreInFlight = true;

    try {
      for (const workspaceId of this.getPersistedWorkspaceEnrollments()) {
        // Already live (e.g. personal reconnect after auth refresh) — leave it.
        if (this.workspaceClients.has(workspaceId)) continue;

        try {
          const identity = this.resolveWorkspaceDeviceIdentity(workspaceId);

          const registered = await this.workspaceDeviceChecker?.(workspaceId, identity.deviceId);
          if (registered === false) {
            logger.info(
              `Workspace share ${workspaceId} was revoked while offline, clearing local enrollment`,
            );
            this.removePersistedWorkspaceEnrollment(workspaceId);
            continue;
          }

          const token = await this.workspaceTokenProvider?.(workspaceId);
          if (!token) {
            logger.warn(`No connect token for workspace ${workspaceId}, skipping restore`);
            continue;
          }

          await this.openWorkspaceClient(workspaceId, token);
          logger.info(`Restored workspace share connection: ${workspaceId}`);
        } catch (error) {
          // Degraded by design: keep the record and retry on the next connect
          // rather than silently dropping the share on a transient failure.
          logger.warn(`Failed to restore workspace share ${workspaceId} (non-fatal):`, error);
        }
      }
    } finally {
      this.workspaceRestoreInFlight = false;
    }
  }

  // ─── Workspace Enrollment Persistence ───

  private getPersistedWorkspaceEnrollments(): string[] {
    const stored = this.app.storeManager.get('gatewayWorkspaceEnrollments') as string[] | undefined;
    return Array.isArray(stored) ? stored.filter((id) => typeof id === 'string') : [];
  }

  private persistWorkspaceEnrollment(workspaceId: string) {
    const current = this.getPersistedWorkspaceEnrollments();
    if (current.includes(workspaceId)) return;
    this.app.storeManager.set('gatewayWorkspaceEnrollments', [...current, workspaceId]);
  }

  private removePersistedWorkspaceEnrollment(workspaceId: string) {
    const current = this.getPersistedWorkspaceEnrollments();
    if (!current.includes(workspaceId)) return;
    this.app.storeManager.set(
      'gatewayWorkspaceEnrollments',
      current.filter((id) => id !== workspaceId),
    );
  }

  // ─── Auth Expired Handling ───

  private async handleAuthExpired() {
    // Disconnect the current client
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }

    if (!this.tokenRefresher) {
      logger.error('No token refresher configured, cannot handle auth_expired');
      this.setStatus('disconnected');
      return;
    }

    logger.info('Attempting token refresh before reconnect');
    const result = await this.tokenRefresher();

    if (result.success) {
      logger.info('Token refreshed, reconnecting');
      await this.doConnect();
    } else {
      logger.error('Token refresh failed:', result.error);
      this.setStatus('disconnected');
    }
  }

  // ─── System Info ───

  private handleSystemInfoRequest(client: GatewayClient, request: SystemInfoRequestMessage) {
    logger.info(`Received system_info_request: requestId=${request.requestId}`);
    client.sendSystemInfoResponse({
      requestId: request.requestId,
      result: {
        success: true,
        systemInfo: {
          arch: os.arch(),
          desktopPath: app.getPath('desktop'),
          documentsPath: app.getPath('documents'),
          downloadsPath: app.getPath('downloads'),
          homePath: app.getPath('home'),
          musicPath: app.getPath('music'),
          picturesPath: app.getPath('pictures'),
          userDataPath: app.getPath('userData'),
          videosPath: app.getPath('videos'),
          workingDirectory: process.cwd(),
        },
      },
    });
  }

  // ─── Generic Device RPC ───

  private async handleRpcRequest(client: GatewayClient, request: RpcRequestMessage) {
    const { method, params, requestId } = request;
    logger.info(`Received rpc_request: method=${method}, requestId=${requestId}`);

    if (!this.rpcHandler) {
      client.sendRpcResponse({
        requestId,
        result: { error: 'No RPC handler registered', success: false },
      });
      return;
    }

    try {
      const data = await this.rpcHandler(method, params);
      client.sendRpcResponse({ requestId, result: { data, success: true } });
    } catch (error) {
      logger.error(`rpc_request method=${method} failed:`, serializeWireError(error));
      client.sendRpcResponse({
        requestId,
        result: { error: serializeWireError(error), success: false },
      });
    }
  }

  // ─── Agent Run ───

  private handleAgentRunRequest = async (
    client: GatewayClient,
    request: AgentRunRequestMessage,
  ) => {
    logger.info(
      `Received agent_run_request: operationId=${request.operationId} type=${request.agentType}`,
    );

    if (!this.agentRunHandler) {
      logger.warn('No agent run handler configured, rejecting request');
      client.sendAgentRunAck({
        operationId: request.operationId,
        reason: 'no handler',
        status: 'rejected',
      });
      return;
    }

    const result = await this.agentRunHandler(request);
    client.sendAgentRunAck({ operationId: request.operationId, ...result });
  };

  // ─── Tool Call Routing ───

  private handleToolCallRequest = async (
    request: ToolCallRequestMessage,
    client: GatewayClient,
  ) => {
    const { requestId, toolCall } = request;
    const { apiName, arguments: argsStr, identifier, params, type } = toolCall;

    logger.info(
      `Received tool call: apiName=${apiName}, requestId=${requestId}, type=${type ?? 'tool'}`,
    );

    try {
      let result: ToolCallResult;

      if (type === 'mcp') {
        // Tunneled stdio MCP call: route to the local MCP client (spawns the
        // stdio server). Routing is driven by the explicit `type` discriminator,
        // not by sniffing the payload — the builtin local-system tool switch
        // keys on `apiName` and has no MCP server context.
        if (!this.mcpCallHandler) {
          throw new Error('No MCP call handler configured');
        }
        if (!params) {
          throw new Error('MCP tool call missing connection params');
        }
        result = await this.mcpCallHandler({ apiName, arguments: argsStr, identifier, params });
      } else {
        if (!this.toolCallHandler) {
          throw new Error('No tool call handler configured');
        }
        const args = JSON.parse(argsStr);
        result = await this.toolCallHandler(identifier, apiName, args);
      }

      // Forward the typed envelope unchanged. Critically, do NOT stringify the
      // whole result into `content` — that would bury the structured payload
      // inside a JSON blob and lose `state`. The wire protocol carries each
      // field separately so downstream (`DeviceGateway` → `RuntimeExecutors`)
      // can persist `state` to `pluginState`. Optional fields are only set
      // when present so payloads stay minimal.
      const wireResult: ToolCallResponseMessage['result'] = {
        content: result.content,
        success: result.success,
      };
      const wireError = serializeWireError(result.error);
      if (wireError !== undefined) wireResult.error = wireError;
      if (result.state !== undefined) wireResult.state = result.state;

      client.sendToolCallResponse({ requestId, result: wireResult });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Tool call failed: apiName=${apiName}, error=${errorMsg}`);

      client.sendToolCallResponse({
        requestId,
        result: {
          content: errorMsg,
          error: errorMsg,
          success: false,
        },
      });
    }
  };

  // ─── Message API Routing ───

  private handleMessageApiRequest = async (
    request: MessageApiRequestMessage,
    client: GatewayClient,
  ) => {
    const { requestId, api } = request;
    const { apiName, payload, platform } = api;

    logger.info(
      `Received message API request: platform=${platform}, apiName=${apiName}, requestId=${requestId}`,
    );

    try {
      if (!this.messageApiHandler) {
        throw new Error('No message API handler configured');
      }

      const result = await this.messageApiHandler(platform, apiName, payload);

      client.sendMessageApiResponse({
        requestId,
        result: {
          content: typeof result === 'string' ? result : JSON.stringify(result),
          success: true,
        },
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(
        `Message API request failed: platform=${platform}, apiName=${apiName}, error=${errorMsg}`,
      );

      client.sendMessageApiResponse({
        requestId,
        result: {
          content: errorMsg,
          error: errorMsg,
          success: false,
        },
      });
    }
  };

  // ─── Power Save Blocker ───

  /**
   * Start power save blocker to prevent macOS App Nap from suspending the process
   * while the gateway connection is active. Uses 'prevent-app-suspension' so the
   * display can still sleep — only the app process is kept alive.
   */
  private startPowerSaveBlocker() {
    if (this.powerSaveBlockerId !== null) return;
    this.powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    logger.info(`Power save blocker started (id=${this.powerSaveBlockerId})`);
  }

  private stopPowerSaveBlocker() {
    if (this.powerSaveBlockerId === null) return;
    powerSaveBlocker.stop(this.powerSaveBlockerId);
    logger.info(`Power save blocker stopped (id=${this.powerSaveBlockerId})`);
    this.powerSaveBlockerId = null;
  }

  // ─── Status Broadcasting ───

  private setStatus(status: GatewayConnectionStatus) {
    if (this.status === status) return;

    logger.info(`Connection status: ${this.status} → ${status}`);
    this.status = status;

    // Keep the app process alive while gateway is connected so macOS App Nap
    // does not suspend it during display sleep, which would drop the WebSocket.
    if (status === 'connected') {
      this.startPowerSaveBlocker();
    } else {
      this.stopPowerSaveBlocker();
    }

    this.app.browserManager.broadcastToAllWindows('gatewayConnectionStatusChanged', { status });
  }

  // ─── Gateway URL ───

  private getGatewayUrl(): string {
    // Env override wins (dev: point at a local `wrangler dev` gateway), then the
    // user-configured store value, then the production default.
    return (
      getDesktopEnv().DEVICE_GATEWAY_URL ||
      this.app.storeManager.get('gatewayUrl') ||
      DEFAULT_GATEWAY_URL
    );
  }

  // ─── Token Helpers ───

  /**
   * Extract userId (sub claim) from JWT without verification.
   * The token will be verified server-side; we just need the userId for routing.
   */
  private extractUserIdFromToken(token: string): string | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      return payload.sub || null;
    } catch {
      logger.warn('Failed to extract userId from JWT token');
      return null;
    }
  }
}
