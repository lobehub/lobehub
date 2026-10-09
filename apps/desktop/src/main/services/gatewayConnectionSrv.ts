import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { OFFICIAL_DEVICE_GATEWAY_URL } from '@lobechat/const/url';
import type {
  EnrollWorkspaceParams,
  EnrollWorkspaceResult,
  UnenrollWorkspaceParams,
} from '@lobechat/device-control';
import type { DeviceMetricsSampler } from '@lobechat/device-control/metrics';
import type {
  AgentRunRequestMessage,
  DeviceSystemInfo,
  GatewayClient,
  GatewayMcpParams,
  MessageApiRequestMessage,
  RpcRequestMessage,
  SystemInfoRequestMessage,
  ToolCallRequestMessage,
  ToolCallResponseMessage,
} from '@lobechat/device-gateway-client';
import type { IdentitySource } from '@lobechat/device-identity';
import type { GatewayConnectionStatus } from '@lobechat/electron-client-ipc';
import { createRuntimeProbeCache } from '@lobechat/heterogeneous-agents/runtimeProbeCache';
import { isRecord } from '@lobechat/utils/object';
import { app, powerSaveBlocker } from 'electron';

import { isDev } from '@/const/env';
import { getDesktopEnv } from '@/env';
import { resolveCliScript } from '@/modules/cliEmbedding';
import { createLogger } from '@/utils/logger';
import { getDesktopUserAgent } from '@/utils/user-agent';
import { safeGetPath } from '@/utils/user-path';

import { ServiceModule } from './index';

const logger = createLogger('services:GatewayConnectionSrv');

const DEFAULT_GATEWAY_URL = OFFICIAL_DEVICE_GATEWAY_URL;

/**
 * The socket drops about once an hour (Cloudflare moving the Durable Object,
 * edge link resets) and is back within ~2s. A drop that recovers inside this
 * window is not surfaced to the UI, so the device indicator doesn't flicker.
 */
const RECONNECT_UI_GRACE_MS = 5000;

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
    params: GatewayMcpParams;
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
    architecture: string;
    deviceId: string;
    hostname: string;
    identitySource: IdentitySource;
    metadata: Record<string, string>;
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
  /** Status last pushed to renderers; lags `status` during a transient drop. */
  private displayedStatus: GatewayConnectionStatus = 'disconnected';
  private statusBroadcastTimer: ReturnType<typeof setTimeout> | null = null;

  private identitySource: IdentitySource | null = null;

  /**
   * Bundled CLI capability probe. Each probe starts an Electron-as-node CLI plus a Codex
   * app-server handshake, while system info is requested during ordinary runs, so it is
   * probed once per connection (and refreshed after the cache lifetime).
   */
  private readonly agentRuntimes = createRuntimeProbeCache(() => this.collectAgentRuntimes());

  private tokenProvider: (() => Promise<string | null>) | null = null;
  private tokenRefresher: (() => Promise<{ error?: string; success: boolean }>) | null = null;
  private toolCallHandler: ToolCallHandler | null = null;
  private mcpCallHandler: McpCallHandler | null = null;
  private messageApiHandler: MessageApiHandler | null = null;
  private agentRunHandler: AgentRunHandler | null = null;
  private rpcHandler: RpcHandler | null = null;
  private deviceRegistrar: DeviceRegistrar | null = null;
  /** Samples CPU / memory / load for the personal device while the connection is on. */
  private metricsSampler: { deviceId: string; sampler: DeviceMetricsSampler } | null = null;
  private workspaceTokenProvider: WorkspaceTokenProvider | null = null;
  private workspaceDeviceChecker: WorkspaceDeviceChecker | null = null;

  /** Live workspace-share connections, keyed by workspaceId. */
  private workspaceClients = new Map<string, GatewayClient>();
  /** Serializes enrollment restores so reconnect churn can't double-open sockets. */
  private workspaceRestoreInFlight = false;
  /**
   * Set once an `auth_failed` has already triggered a token refresh for the
   * current personal connection. Unlike `auth_expired`, `auth_failed` is
   * terminal inside the gateway client (it disconnects and switches the backoff
   * reconnect off), so the service is the only thing that can bring the socket
   * back — and this guard is what stops a refresh that keeps yielding a
   * rejected token from spinning forever. Cleared by a successful
   * authentication, or by a user-initiated connect.
   */
  private authRecoveryAttempted = false;
  /**
   * Workspace clients that already spent their single `auth_failed` retry. A
   * weak set on purpose: the retry budget is per client instance (a re-enroll
   * builds a new one), so entries must die with their client.
   */
  private workspaceAuthRetried = new WeakSet<GatewayClient>();

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
   * Push a freshly refreshed access token into the live personal connection.
   *
   * The gateway client captures its token at construction and replays that same
   * value on every backoff / heartbeat reconnect, while the access token is
   * refreshed elsewhere (AuthCtr's auto-refresh timer, not the gateway path).
   * Without this push, a token that roams past `exp` while the socket is
   * healthy is re-sent on the next reconnect, rejected with `auth_failed`, and
   * the device goes offline until the user intervenes.
   */
  updatePersonalToken(token: string) {
    this.client?.updateToken(token);
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
  async resolveDeviceIdentity(
    userId: string,
  ): Promise<{ deviceId: string; identitySource: IdentitySource }> {
    const { deriveDeviceId } = await import('@lobechat/device-identity');
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

  /** Status as shown in the UI — hides reconnects that recover quickly. */
  getDisplayedStatus(): GatewayConnectionStatus {
    return this.displayedStatus;
  }

  getDeviceInfo() {
    return {
      deviceId: this.getDeviceId(),
      hostname: os.hostname(),
      platform: process.platform,
    };
  }

  /**
   * Whether a registry device id belongs to this physical desktop.
   *
   * A machine can be reachable through both its personal identity and one
   * derived identity per persisted workspace enrollment. Reconnect deep links
   * must accept all of those identities without waking a different machine.
   */
  async matchesDeviceId(deviceId: string): Promise<boolean> {
    if (this.getDeviceId() === deviceId) return true;

    const token = await this.tokenProvider?.();
    const userId = token ? this.extractUserIdFromToken(token) : undefined;
    if (userId) {
      const identity = await this.resolveDeviceIdentity(userId);
      if (identity.deviceId === deviceId) return true;
    }

    for (const workspaceId of this.getPersistedWorkspaceEnrollments()) {
      const identity = await this.resolveWorkspaceDeviceIdentity(workspaceId);
      if (identity.deviceId === deviceId) return true;
    }

    return false;
  }

  // ─── Connection Logic ───

  async connect(): Promise<{ error?: string; success: boolean }> {
    if (this.status === 'connected' || this.status === 'connecting') {
      return { success: true };
    }
    // A user-initiated connect always gets a fresh retry budget — only the
    // automatic recoveries are rationed by the guard.
    this.authRecoveryAttempted = false;
    return this.doConnect();
  }

  async disconnect(): Promise<{ success: boolean }> {
    // A user-initiated disconnect turns the device off, so stop sampling too —
    // the page then shows no data rather than "running but unreachable". The
    // samples since the last upload are pushed first (bounded), while the
    // socket is still open.
    await this.stopMetricsSampler({ flushTimeoutMs: 3000 });
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
      const identity = await this.resolveDeviceIdentity(userId);
      await this.deviceRegistrar?.({
        architecture: os.arch(),
        deviceId: identity.deviceId,
        hostname: os.hostname(),
        identitySource: identity.identitySource,
        metadata: {
          appVersion: app.getVersion(),
          electron: process.versions.electron,
          node: process.versions.node,
          osRelease: os.release(),
        },
        platform: process.platform,
      }).catch((err) => {
        logger.warn(`Device registration failed (non-fatal): ${(err as Error).message}`);
      });
      await this.startMetricsSampler(identity.deviceId);
    }

    const { GatewayClient } = await import('@lobechat/device-gateway-client');
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
      void this.handleSystemInfoRequest(client, request);
    });

    client.on('rpc_request', (request) => {
      this.handleRpcRequest(client, request);
    });

    client.on('agent_run_request', (request) => {
      this.handleAgentRunRequest(client, request, scope?.workspaceId);
    });

    client.on('auth_expired', () => {
      if (scope) {
        logger.warn(`Workspace ${scope.workspaceId} connect token expired, re-minting`);
        void this.handleWorkspaceAuthExpired(scope.workspaceId);
      } else {
        logger.warn('Received auth_expired, will reconnect with refreshed token');
        void this.handleAuthExpired();
      }
    });

    client.on('auth_failed', (reason) => {
      if (scope) {
        void this.handleWorkspaceAuthFailed(scope.workspaceId, reason);
      } else {
        void this.handleAuthFailed(reason);
      }
    });

    client.on('connected', () => {
      // A live authenticated socket is the reset point for the auth_failed
      // retry guards: the next rejection gets a fresh single retry.
      if (scope) {
        this.workspaceAuthRetried.delete(client);
      } else {
        this.authRecoveryAttempted = false;
      }
    });

    client.on('replaced', () => {
      logger.warn(
        `Gateway connection${scope ? ` for workspace ${scope.workspaceId}` : ''} was taken over by another client with the same connection id; not reconnecting`,
      );
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
  private async resolveWorkspaceDeviceIdentity(
    workspaceId: string,
  ): Promise<EnrollWorkspaceResult> {
    const { deriveDeviceId, deriveScopedFallbackId } = await import('@lobechat/device-identity');
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

    const identity = await this.resolveWorkspaceDeviceIdentity(workspaceId);

    const { GatewayClient } = await import('@lobechat/device-gateway-client');
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
   * A workspace share connection was rejected outright by the gateway. Recover
   * the same way as an expired connect token — re-mint and reconnect in place —
   * but only once per client instance, so a share that keeps being rejected
   * (revoked membership / revoked share) is closed instead of retried forever.
   * The persisted enrollment is kept: the next startup's restore path settles it
   * against the server row.
   */
  private async handleWorkspaceAuthFailed(workspaceId: string, reason: string) {
    const client = this.workspaceClients.get(workspaceId);
    if (!client) return;

    if (this.workspaceAuthRetried.has(client)) {
      logger.warn(
        `Workspace ${workspaceId} authentication failed again (${reason}), closing share connection`,
      );
      await this.closeWorkspaceClient(workspaceId);
      return;
    }

    this.workspaceAuthRetried.add(client);
    logger.warn(
      `Workspace ${workspaceId} authentication failed (${reason}), re-minting connect token`,
    );
    await this.handleWorkspaceAuthExpired(workspaceId);
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
          const identity = await this.resolveWorkspaceDeviceIdentity(workspaceId);

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

  // ─── Auth Expired / Failed Handling ───

  /**
   * Refresh the user token and rebuild the personal connection. A failed
   * refresh settles on `disconnected` and waits for the next user action or app
   * start — the refresher already reports the OIDC reason.
   */
  private async refreshTokenAndReconnect() {
    // Disconnect the current client
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }

    if (!this.tokenRefresher) {
      logger.error('No token refresher configured, cannot refresh the access token');
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

  private async handleAuthExpired() {
    await this.refreshTokenAndReconnect();
  }

  /**
   * The gateway rejected our token outright (`auth_failed`). Unlike
   * `auth_expired` this is terminal inside the gateway client: it emits the
   * event and then calls `disconnect()`, which turns the backoff reconnect off.
   * With nobody listening the socket stayed down — and because the UI switch
   * reads the connection status, it surfaced as the switch turning itself off —
   * until the user toggled it or restarted the app.
   *
   * Refresh once and reconnect. {@link authRecoveryAttempted} keeps a refresh
   * that yields another rejected token (revoked grant, clock skew) from looping.
   */
  private async handleAuthFailed(reason: string) {
    if (this.authRecoveryAttempted) {
      logger.error(
        `Authentication failed again after a token refresh (${reason}); staying disconnected until the next connect`,
      );
      this.setStatus('disconnected');
      return;
    }

    this.authRecoveryAttempted = true;
    logger.warn(`Authentication failed: ${reason}. Attempting token refresh before reconnect...`);
    await this.refreshTokenAndReconnect();
  }

  // ─── System Info ───

  /**
   * Triggering workflow: gateway `system_info_request` -> handleSystemInfoRequest
   * -> {@link GatewayClient.sendSystemInfoResponse}, including desktop tool support.
   */
  private async handleSystemInfoRequest(client: GatewayClient, request: SystemInfoRequestMessage) {
    logger.info(`Received system_info_request: requestId=${request.requestId}`);
    try {
      client.sendSystemInfoResponse({
        requestId: request.requestId,
        result: { success: true, systemInfo: await this.collectSystemInfo() },
      });
    } catch (error) {
      // The gateway keeps the agent run parked until a correlated reply arrives,
      // so a failed collection must still answer instead of only logging.
      logger.error(`system_info_request failed: requestId=${request.requestId}`, error);
      client.sendSystemInfoResponse({ requestId: request.requestId, result: { success: false } });
    }
  }

  /**
   * Reports only native capabilities confirmed by the CLI bundled with this Desktop.
   *
   * Use when: the gateway requests live execution capabilities for a bound device.
   * Expects: the same embedded script and Electron Node runtime used for agent runs.
   * Returns: an empty capability list if the CLI is absent, incompatible, or unresponsive.
   *
   * Call stack:
   * handleSystemInfoRequest -> {@link collectSystemInfo} -> agentRuntimes.get
   *   -> {@link collectAgentRuntimes} -> {@link resolveCliScript}
   *     -> lh connect capabilities -> supportsNativeCodex -> Codex initialize
   */
  private async collectAgentRuntimes(): Promise<string[]> {
    try {
      // Use the bundled entrypoint rather than a global lh that may lag this build.
      // The CLI bounds its native handshake to 6 seconds; this outer deadline also
      // bounds process startup while staying within the gateway's 10-second budget.
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [resolveCliScript(), 'connect', 'capabilities'],
        {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
          maxBuffer: 64 * 1024,
          timeout: 9000,
          windowsHide: true,
        },
      );
      const result: unknown = JSON.parse(stdout);
      if (!isRecord(result) || !Array.isArray(result.supportedAgentRuntimes)) return [];
      return result.supportedAgentRuntimes.includes('codex-app-server-v1')
        ? ['codex-app-server-v1']
        : [];
    } catch (error) {
      logger.debug('Bundled CLI native capability probe unavailable', error);
      return [];
    }
  }

  private async collectSystemInfo(): Promise<DeviceSystemInfo> {
    const { getShellInfo } = await import('@lobechat/local-file-shell/shell');
    return {
      supportedTools: ['lobe-computer-use'],
      supportedAgentRuntimes: await this.agentRuntimes.get(),
      arch: os.arch(),
      // Tell the server-side prompt builder which shell runCommand spawns here.
      defaultShell: (await getShellInfo()).displayName,
      desktopPath: app.getPath('desktop'),
      documentsPath: app.getPath('documents'),
      downloadsPath: safeGetPath('downloads'),
      homePath: app.getPath('home'),
      musicPath: safeGetPath('music'),
      picturesPath: safeGetPath('pictures'),
      userDataPath: app.getPath('userData'),
      videosPath: safeGetPath('videos'),
      workingDirectory: process.cwd(),
    };
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
    connectionWorkspaceId?: string,
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

    // Topic scope for heteroIngest/heteroFinish. Prefer the explicit ingest
    // field, then a forwarded routing workspaceId, then the connection this
    // request arrived on (workspace enrollments). Older gateways omit both
    // payload fields; the workspace socket is still a reliable fallback.
    const workspaceId = request.ingestWorkspaceId ?? request.workspaceId ?? connectionWorkspaceId;
    const result = await this.agentRunHandler(
      workspaceId && workspaceId !== request.workspaceId ? { ...request, workspaceId } : request,
    );
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

    // Timed on THIS machine's clock, around both routes. The server can only
    // observe the whole dispatch round trip, so without this number a slow tool
    // and slow transport are indistinguishable — and desktop is where most
    // device tool calls actually happen, so leaving it out here would bias the
    // measurement toward the `lh connect` subset.
    const startedAt = performance.now();

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
        executionTimeMs: Math.round(performance.now() - startedAt),
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
          // A failure is timed too: a tool that took 30s to fail is as
          // interesting as one that took 30s to succeed.
          executionTimeMs: Math.round(performance.now() - startedAt),
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

  getKeepAwake(): boolean {
    return this.app.storeManager.get('gatewayKeepAwake', true);
  }

  setKeepAwake(enabled: boolean) {
    this.app.storeManager.set('gatewayKeepAwake', enabled);
    logger.info(`Keep awake while connected: ${enabled}`);
    this.syncPowerSaveBlocker();
  }

  /**
   * Hold the blocker for as long as the device is meant to be online — not
   * just while the socket is `connected`. Releasing it on every transient drop
   * (the socket blips every few tens of minutes) hands macOS a window to idle
   * sleep: with the default "sleep 1 minute after the display turns off" the
   * idle timer has long expired, so the machine sleeps before the ~2s reconnect
   * lands and stays offline until the user comes back. Only an explicit
   * disconnect (status settles on `disconnected`) or the user opting out lets
   * the system sleep again.
   */
  private syncPowerSaveBlocker() {
    if (this.status !== 'disconnected' && this.getKeepAwake()) {
      this.startPowerSaveBlocker();
    } else {
      this.stopPowerSaveBlocker();
    }
  }

  /**
   * 'prevent-app-suspension' keeps the system from idle-sleeping (and App Nap
   * from suspending the process) while still letting the display sleep.
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

  // ─── Device Metrics ───

  /**
   * Keeps sampling across drops and reconnects (that stretch is what explains
   * a drop); only a new identity or an explicit disconnect replaces it.
   * Samples go to the device gateway (their only store) over the personal
   * connection, whichever client instance currently holds it.
   */
  private async startMetricsSampler(deviceId: string) {
    if (this.metricsSampler?.deviceId === deviceId) return;
    await this.stopMetricsSampler();

    const userData = safeGetPath('userData');
    const { DeviceMetricsSampler, deviceMetricsBacklogFileName, pushMetrics } =
      await import('@lobechat/device-control/metrics');
    const sampler = new DeviceMetricsSampler({
      isConnected: () => this.status === 'connected',
      logger: { warn: (msg) => logger.warn(msg) },
      storagePath: userData
        ? path.join(userData, 'device-metrics', deviceMetricsBacklogFileName(deviceId))
        : undefined,
      // Mirrored to the workspace-share connections so a shared device's
      // workspace row has the same history (the gateway stores per socket).
      upload: async (samples) => {
        if (!this.client) throw new Error('Gateway not connected');
        await pushMetrics(this.client, this.workspaceClients.values(), samples);
      },
    });
    this.metricsSampler = { deviceId, sampler };
    await sampler.start();
  }

  private async stopMetricsSampler(options?: { flushTimeoutMs?: number }) {
    const current = this.metricsSampler;
    this.metricsSampler = null;
    await current?.sampler.stop(options);
  }

  // ─── Status Broadcasting ───

  private setStatus(status: GatewayConnectionStatus) {
    if (this.status === status) return;

    logger.info(`Connection status: ${this.status} → ${status}`);
    this.status = status;

    // Upload what accrued while offline right away, not at the next tick.
    if (status === 'connected') {
      void this.metricsSampler?.sampler.flush();
      // A (re)connection reprobes the bundled CLI and warms the cache for the first request.
      this.agentRuntimes.invalidate();
      void this.agentRuntimes.get();
    }
    this.syncPowerSaveBlocker();
    this.scheduleStatusBroadcast(status);
  }

  private scheduleStatusBroadcast(status: GatewayConnectionStatus) {
    if (this.statusBroadcastTimer) {
      clearTimeout(this.statusBroadcastTimer);
      this.statusBroadcastTimer = null;
    }

    // Leaving `connected` for a reconnect: hold the UI on `connected` for a
    // grace period. An explicit `disconnected` is always shown immediately.
    const isTransientDrop =
      this.displayedStatus === 'connected' && status !== 'connected' && status !== 'disconnected';
    if (isTransientDrop) {
      this.statusBroadcastTimer = setTimeout(() => {
        this.statusBroadcastTimer = null;
        this.broadcastStatus(this.status);
      }, RECONNECT_UI_GRACE_MS);
      return;
    }

    this.broadcastStatus(status);
  }

  private broadcastStatus(status: GatewayConnectionStatus) {
    if (this.displayedStatus === status) return;
    this.displayedStatus = status;
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
