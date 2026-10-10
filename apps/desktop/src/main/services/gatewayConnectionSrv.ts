import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

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
import {
  type DeviceGatewayEndpoint,
  type DeviceGatewayResolutionWithDefault,
  deviceGatewayServerKey,
  normalizeDeviceGatewayUrl,
  resolveDeviceGatewayEndpoint,
} from '@lobechat/device-gateway-client/endpoint';
import type { IdentitySource } from '@lobechat/device-identity';
import type {
  GatewayConnectionError,
  GatewayConnectionState,
  GatewayConnectionStatus,
  GatewayConnectResult,
  GatewayEndpointInfo,
  SetGatewayManualUrlResult,
} from '@lobechat/electron-client-ipc';
import { app, powerSaveBlocker } from 'electron';

import { isDev } from '@/const/env';
import { getDesktopEnv } from '@/env';
import { createLogger } from '@/utils/logger';
import { getDesktopUserAgent } from '@/utils/user-agent';
import { safeGetPath } from '@/utils/user-path';

import { discoverDeviceGateway } from './gatewayDiscovery';
import { ServiceModule } from './index';

const logger = createLogger('services:GatewayConnectionSrv');

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

/** The server + credential one connection attempt was resolved against. */
interface GatewayAuthContext {
  serverUrl: string;
  token: string;
}

interface DeviceRegistrar {
  (
    info: {
      architecture: string;
      deviceId: string;
      hostname: string;
      identitySource: IdentitySource;
      metadata: Record<string, string>;
      platform: string;
    },
    auth: GatewayAuthContext,
  ): Promise<void>;
}

/**
 * Mint a fresh workspace-device connect token for a share connection. Injected
 * by the controller (which owns the authed server calls) — used when restoring
 * persisted enrollments on startup and when a workspace connection's token
 * expires. `serverUrl` is the server the personal connection belongs to: the
 * provider returns null instead of minting on another server (signed out or
 * switched meanwhile).
 */
interface WorkspaceTokenProvider {
  (workspaceId: string, serverUrl: string): Promise<string | null>;
}

/** What the server says about this machine's row in a workspace. */
export interface WorkspaceDeviceRegistration {
  /** The member who enrolled the row, when the server reports one. */
  enrollerUserId?: string;
  registered: boolean;
}

/**
 * Check whether the workspace-scoped deviceId still has a registered row on
 * `serverUrl`. `registered: false` is a definitive "row gone" answer (share
 * revoked while offline); `undefined` means the check could not be performed —
 * callers must NOT clear local state on `undefined`.
 */
interface WorkspaceDeviceChecker {
  (
    workspaceId: string,
    deviceId: string,
    serverUrl: string,
  ): Promise<WorkspaceDeviceRegistration | undefined>;
}

/**
 * The context a personal connection was opened in. Workspace share connections
 * reuse it, so every socket of one session talks to the same gateway on behalf
 * of the same account; anything resolved for an older session is discarded.
 */
interface GatewaySession {
  /** `<serverKey>#<userId>`: scopes persisted workspace enrollments. */
  accountKey?: string;
  endpoint: DeviceGatewayEndpoint;
  serverKey: string;
  serverUrl: string;
  userId: string | null;
}

const CANCELLED: GatewayConnectResult = {
  error: 'Connection attempt was superseded',
  success: false,
};

const describeResolutionFailure = (
  resolution: Extract<DeviceGatewayResolutionWithDefault, { ok: false }>,
): GatewayConnectionError => {
  switch (resolution.reason) {
    case 'discovery_failed': {
      return { code: 'config_unavailable', detail: resolution.detail };
    }
    case 'invalid_advertised_url':
    case 'invalid_manual':
    case 'invalid_override': {
      return { code: 'invalid_gateway_url', detail: resolution.detail };
    }
  }
};

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
  private displayedError: GatewayConnectionError | null = null;
  private statusBroadcastTimer: ReturnType<typeof setTimeout> | null = null;
  /** Why the last attempt ended; cleared by the next attempt or a disconnect. */
  private connectionError: GatewayConnectionError | null = null;

  /**
   * Bumped by every new connection attempt and every disconnect (sign-out,
   * instance switch). An async step that resumes under an older generation
   * has been superseded and must not open or re-key anything.
   */
  private generation = 0;
  private discoveryAbort: AbortController | null = null;
  private pendingConnect: Promise<GatewayConnectResult> | null = null;
  private session: GatewaySession | null = null;

  private identitySource: IdentitySource | null = null;

  private serverUrlProvider: (() => Promise<string | undefined>) | null = null;
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
  /** Serializes enrollment restores per session so reconnect churn can't double-open sockets. */
  private workspaceRestoreFor: GatewaySession | null = null;
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
   * The server the desktop is signed in to. Read together with the token at the
   * start of every attempt, so discovery, the gateway and the credential all
   * belong to one login.
   */
  setServerUrlProvider(provider: () => Promise<string | undefined>) {
    this.serverUrlProvider = provider;
  }

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
   *
   * Only a token for the account this connection belongs to is taken: a new
   * sign-in also stores its token here first, and the sign-in itself rebuilds
   * the connection for its own server.
   */
  updatePersonalToken(token: string) {
    const session = this.session;
    if (!this.client || !session) return;
    if (this.extractUserIdFromToken(token) !== session.userId) return;
    this.client.updateToken(token);
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
   * connect once the userId is known (deviceId is user-scoped), with the server
   * and token of that attempt so the row lands where the socket authenticates.
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

  /** What the UI shows: the displayed status plus why the last attempt ended. */
  getDisplayedState(): GatewayConnectionState {
    return this.displayedError
      ? { error: this.displayedError, status: this.displayedStatus }
      : { status: this.displayedStatus };
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

    const [serverUrl, token] = await Promise.all([
      this.serverUrlProvider?.(),
      this.tokenProvider?.(),
    ]);
    const userId = token ? this.extractUserIdFromToken(token) : undefined;
    if (userId) {
      const identity = await this.resolveDeviceIdentity(userId);
      if (identity.deviceId === deviceId) return true;
    }

    // Workspace identities are per machine, so a pre-scoping record still
    // identifies this computer; whether it is restored is decided on connect.
    const accountKey = this.toAccountKey(serverUrl, userId);
    const workspaceIds = new Set([
      ...(accountKey ? this.getPersistedWorkspaceEnrollments(accountKey) : []),
      ...this.getLegacyWorkspaceEnrollments(),
    ]);
    for (const workspaceId of workspaceIds) {
      const identity = await this.resolveWorkspaceDeviceIdentity(workspaceId);
      if (identity.deviceId === deviceId) return true;
    }

    return false;
  }

  // ─── Connection Logic ───

  /**
   * Start (or join) a connection for the current login. Startup auto-connect,
   * post-login connect, the toggle, deep-link reconnects and the auth refresh
   * all come through here, so they share discovery and the generation guard.
   */
  async connect(): Promise<GatewayConnectResult> {
    if (this.pendingConnect) return this.pendingConnect;
    if (this.status === 'connected' || this.status === 'connecting') {
      return { success: true };
    }
    // A user-initiated connect always gets a fresh retry budget — only the
    // automatic recoveries are rationed by the guard.
    this.authRecoveryAttempted = false;
    return this.startConnect();
  }

  /**
   * Drop everything bound to the previous login and connect afresh. Used after
   * a new sign-in, which may be another account or another server.
   */
  async restart(): Promise<GatewayConnectResult> {
    await this.disconnect();
    // A sign-in is a user-initiated connect: it gets a fresh auth_failed budget.
    this.authRecoveryAttempted = false;
    return this.startConnect();
  }

  /**
   * Close the personal and every workspace connection and invalidate whatever
   * was resolved for them: in-flight discovery is aborted and any attempt still
   * running resumes as stale, so a late answer can never reopen a socket — let
   * alone send this login's token to the previous server's gateway.
   */
  async disconnect(): Promise<{ success: boolean }> {
    this.invalidateAttempts();
    this.session = null;
    this.connectionError = null;

    // A user-initiated disconnect turns the device off, so stop sampling too —
    // the page then shows no data rather than "running but unreachable". The
    // samples since the last upload are pushed first (bounded), while the
    // socket is still open.
    await this.stopMetricsSampler({ flushTimeoutMs: 3000 });
    const client = this.client;
    this.client = null;
    await client?.disconnect();
    // Take the workspace share connections down with the personal one (the
    // device goes fully offline), but keep the persisted enrollments — the next
    // connect restores them.
    await this.closeAllWorkspaceClients();
    this.setStatus('disconnected');
    this.scheduleStatusBroadcast(this.status);
    return { success: true };
  }

  private startConnect(options?: { reuse?: GatewaySession }): Promise<GatewayConnectResult> {
    const attempt = this.doConnect(options).finally(() => {
      if (this.pendingConnect === attempt) this.pendingConnect = null;
    });
    this.pendingConnect = attempt;
    return attempt;
  }

  private invalidateAttempts(): number {
    this.generation += 1;
    this.discoveryAbort?.abort();
    this.discoveryAbort = null;
    this.pendingConnect = null;
    return this.generation;
  }

  private isStale(generation: number) {
    return generation !== this.generation;
  }

  /**
   * @param options.reuse Session of a connection being re-established (auth
   *   refresh). Its endpoint is kept when the login is unchanged, like the
   *   client's own short reconnects; a different server or account resolves
   *   again.
   */
  private async doConnect({
    reuse,
  }: { reuse?: GatewaySession } = {}): Promise<GatewayConnectResult> {
    const generation = this.invalidateAttempts();

    // Clean up any existing client
    if (this.client) {
      const previous = this.client;
      this.client = null;
      await previous.disconnect();
    }
    if (this.isStale(generation)) return CANCELLED;

    // Loading the server's config is part of connecting.
    this.connectionError = null;
    this.setStatus('connecting');

    if (!this.tokenProvider || !this.serverUrlProvider) {
      logger.warn('Cannot connect: no token provider configured');
      return this.failConnect(
        generation,
        { code: 'not_signed_in' },
        'No token provider configured',
      );
    }

    const [serverUrl, token] = await Promise.all([this.serverUrlProvider(), this.tokenProvider()]);
    if (this.isStale(generation)) return CANCELLED;

    if (!token) {
      logger.warn('Cannot connect: no access token');
      return this.failConnect(generation, { code: 'not_signed_in' }, 'No access token available');
    }

    const serverKey = serverUrl ? deviceGatewayServerKey(serverUrl) : undefined;
    if (!serverUrl || !serverKey) {
      logger.warn('Cannot connect: no remote server configured');
      return this.failConnect(generation, { code: 'not_signed_in' }, 'No remote server configured');
    }

    const userId = this.extractUserIdFromToken(token);
    const endpoint: DeviceGatewayResolutionWithDefault =
      reuse && reuse.serverKey === serverKey && reuse.userId === userId
        ? { endpoint: reuse.endpoint, ok: true }
        : await this.resolveEndpoint(serverUrl);
    if (this.isStale(generation)) return CANCELLED;

    // `in`, not `ok`: this project compiles without strictNullChecks, where a
    // boolean discriminant does not narrow.
    if ('reason' in endpoint) {
      const error = describeResolutionFailure(endpoint);
      logger.warn(
        `Cannot connect: device gateway for ${serverUrl} unresolved (${endpoint.reason}${endpoint.detail ? `: ${endpoint.detail}` : ''})`,
      );
      return this.failConnect(generation, error, `Device gateway unavailable: ${endpoint.reason}`);
    }

    const { url: gatewayUrl, source } = endpoint.endpoint;
    logger.info(
      `Connecting to device gateway: ${gatewayUrl} (${source}), server: ${serverUrl}, userId: ${userId || 'unknown'}`,
    );

    const session: GatewaySession = {
      accountKey: this.toAccountKey(serverUrl, userId),
      endpoint: endpoint.endpoint,
      serverKey,
      serverUrl,
      userId,
    };
    // Share connections are only kept across a reconnect of the same login to
    // the same gateway; anything else belongs to the previous session.
    if (this.session && !this.isSameSession(this.session, session)) {
      await this.closeAllWorkspaceClients();
      if (this.isStale(generation)) return CANCELLED;
    }
    this.session = session;

    // Resolve the stable, user-scoped device id and register with the server
    // registry before opening the WS, so the device row exists by the time the
    // gateway reports it online.
    if (userId) {
      const identity = await this.resolveDeviceIdentity(userId);
      if (this.isStale(generation)) return CANCELLED;
      await this.deviceRegistrar?.(
        {
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
        },
        { serverUrl, token },
      ).catch((err) => {
        logger.warn(`Device registration failed (non-fatal): ${(err as Error).message}`);
      });
      if (this.isStale(generation)) return CANCELLED;
      await this.startMetricsSampler(identity.deviceId);
    }

    const { GatewayClient } = await import('@lobechat/device-gateway-client');
    if (this.isStale(generation)) return CANCELLED;

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
    void this.restoreWorkspaceEnrollments(session).catch((err) => {
      logger.warn('Workspace enrollment restore failed (non-fatal):', err);
    });

    return { success: true };
  }

  private failConnect(
    generation: number,
    error: GatewayConnectionError,
    message: string,
  ): GatewayConnectResult {
    if (this.isStale(generation)) return CANCELLED;
    this.connectionError = error;
    this.setStatus('disconnected');
    // The status may not have changed (e.g. failing before any socket), but
    // the reason did.
    this.scheduleStatusBroadcast(this.status);
    return { error: message, errorCode: error.code, success: false };
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
      // A replaced client still reports its own teardown; only the current one
      // speaks for the device.
      client.on('status_changed', (status) => {
        if (this.client === client) this.setStatus(status);
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
        void this.handleWorkspaceAuthExpired(scope.workspaceId, client);
      } else {
        logger.warn('Received auth_expired, will reconnect with refreshed token');
        void this.handleAuthExpired(client);
      }
    });

    client.on('auth_failed', (reason) => {
      if (scope) {
        void this.handleWorkspaceAuthFailed(scope.workspaceId, client, reason);
      } else {
        void this.handleAuthFailed(client, reason);
      }
    });

    client.on('connected', () => {
      // A live authenticated socket is the reset point for the auth_failed
      // retry guards: the next rejection gets a fresh single retry. A replaced
      // client's late success says nothing about the current one.
      if (scope) {
        this.workspaceAuthRetried.delete(client);
      } else if (this.client === client) {
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

    // The RPC arrives over the personal connection, so the share joins its
    // session: same gateway, persisted for the same account.
    const session = this.session;
    if (!session) throw new Error('Device gateway is not connected');

    const identity = await this.openWorkspaceClient(params.workspaceId, params.token, session);
    if (session.accountKey) this.persistWorkspaceEnrollment(session.accountKey, params.workspaceId);
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
    if (this.session?.accountKey) {
      this.removePersistedWorkspaceEnrollment(this.session.accountKey, params.workspaceId);
    }
    // The workspace identity is per machine, so a revoke also settles a
    // pre-scoping record of the same workspace.
    this.removeLegacyWorkspaceEnrollment(params.workspaceId);
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
    session: GatewaySession,
  ): Promise<EnrollWorkspaceResult> {
    // Re-enroll replaces the previous share connection instead of stacking one.
    await this.closeWorkspaceClient(workspaceId);

    const identity = await this.resolveWorkspaceDeviceIdentity(workspaceId);

    const { GatewayClient } = await import('@lobechat/device-gateway-client');
    if (!this.isCurrentSession(session)) {
      throw new Error('Device gateway session changed while opening the share connection');
    }

    const client = new GatewayClient({
      channel: isDev ? 'desktop-dev' : 'desktop',
      // Reuse the install's connectionId: the gateway dedupes stale sockets per
      // principal, so the workspace connection only ever replaces its own
      // predecessor, never the personal socket.
      connectionId: this.getConnectionId(),
      deviceId: identity.deviceId,
      gatewayUrl: session.endpoint.url,
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

  private async closeAllWorkspaceClients() {
    for (const workspaceId of this.workspaceClients.keys()) {
      await this.closeWorkspaceClient(workspaceId);
    }
  }

  /**
   * Workspace share connections authenticate with a short-lived minted token,
   * not the user token — on expiry, re-mint via the injected provider and
   * reconnect in place. A failed re-mint (share/membership likely revoked)
   * closes the socket but keeps the persisted enrollment: the next startup's
   * restore path settles it against the server row.
   */
  private async handleWorkspaceAuthExpired(workspaceId: string, client: GatewayClient) {
    const session = this.session;
    if (!session || this.workspaceClients.get(workspaceId) !== client) return;

    try {
      const token = await this.workspaceTokenProvider?.(workspaceId, session.serverUrl);
      // Signed out, switched server or replaced meanwhile: nothing to re-key.
      if (!this.isCurrentSession(session) || this.workspaceClients.get(workspaceId) !== client)
        return;
      if (!token) throw new Error('no workspace connect token available');
      client.updateToken(token);
      await client.reconnect();
    } catch (error) {
      logger.warn(`Workspace ${workspaceId} token re-mint failed, closing share:`, error);
      if (this.workspaceClients.get(workspaceId) === client) {
        await this.closeWorkspaceClient(workspaceId);
      }
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
  private async handleWorkspaceAuthFailed(
    workspaceId: string,
    client: GatewayClient,
    reason: string,
  ) {
    // Closed, replaced or signed out meanwhile: not this share's verdict.
    if (this.workspaceClients.get(workspaceId) !== client) return;

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
    await this.handleWorkspaceAuthExpired(workspaceId, client);
  }

  /**
   * Re-open the share connections this account persisted in a previous run.
   * Before reconnecting, confirm the derived workspace deviceId still has a
   * registered row — the share may have been revoked while the app was offline
   * (the server can't deliver `unenrollWorkspace` to a dead socket), and
   * reconnecting anyway would resurrect the device as a ghost in the workspace
   * pool.
   *
   * Records from before enrollments were scoped carry no account. One is
   * adopted only when the server shows the signed-in user enrolled that row;
   * otherwise it is left alone, so another account's share is never reopened
   * under this login.
   */
  private async restoreWorkspaceEnrollments(session: GatewaySession) {
    const { accountKey } = session;
    if (!accountKey) return;
    if (this.workspaceRestoreFor && this.isSameSession(this.workspaceRestoreFor, session)) return;
    this.workspaceRestoreFor = session;

    try {
      const owned = this.getPersistedWorkspaceEnrollments(accountKey);
      const candidates = [
        ...owned.map((workspaceId) => ({ legacy: false, workspaceId })),
        ...this.getLegacyWorkspaceEnrollments()
          .filter((workspaceId) => !owned.includes(workspaceId))
          .map((workspaceId) => ({ legacy: true, workspaceId })),
      ];

      for (const { legacy, workspaceId } of candidates) {
        if (!this.isCurrentSession(session)) return;
        // Already live (e.g. personal reconnect after auth refresh) — leave it.
        if (this.workspaceClients.has(workspaceId)) continue;

        try {
          const identity = await this.resolveWorkspaceDeviceIdentity(workspaceId);

          const registration = await this.workspaceDeviceChecker?.(
            workspaceId,
            identity.deviceId,
            session.serverUrl,
          );
          if (!this.isCurrentSession(session)) return;

          if (legacy) {
            if (
              !registration?.registered ||
              !session.userId ||
              registration.enrollerUserId !== session.userId
            ) {
              logger.info(
                `Workspace share ${workspaceId} predates account scoping and is not this account's, leaving it untouched`,
              );
              continue;
            }
            this.adoptLegacyWorkspaceEnrollment(accountKey, workspaceId);
          } else if (registration?.registered === false) {
            logger.info(
              `Workspace share ${workspaceId} was revoked while offline, clearing local enrollment`,
            );
            this.removePersistedWorkspaceEnrollment(accountKey, workspaceId);
            continue;
          }

          const token = await this.workspaceTokenProvider?.(workspaceId, session.serverUrl);
          if (!this.isCurrentSession(session)) return;
          if (!token) {
            logger.warn(`No connect token for workspace ${workspaceId}, skipping restore`);
            continue;
          }

          await this.openWorkspaceClient(workspaceId, token, session);
          logger.info(`Restored workspace share connection: ${workspaceId}`);
        } catch (error) {
          // Degraded by design: keep the record and retry on the next connect
          // rather than silently dropping the share on a transient failure.
          logger.warn(`Failed to restore workspace share ${workspaceId} (non-fatal):`, error);
        }
      }
    } finally {
      if (this.workspaceRestoreFor === session) this.workspaceRestoreFor = null;
    }
  }

  // ─── Workspace Enrollment Persistence ───

  private toAccountKey(serverUrl: string | undefined, userId: string | null | undefined) {
    const serverKey = serverUrl ? deviceGatewayServerKey(serverUrl) : undefined;
    return serverKey && userId ? `${serverKey}#${userId}` : undefined;
  }

  private getEnrollmentsByAccount(): Record<string, string[]> {
    const stored = this.app.storeManager.get('gatewayWorkspaceEnrollmentsByAccount');
    return stored && typeof stored === 'object' ? stored : {};
  }

  private getPersistedWorkspaceEnrollments(accountKey: string): string[] {
    const stored = this.getEnrollmentsByAccount()[accountKey];
    return Array.isArray(stored) ? stored.filter((id) => typeof id === 'string') : [];
  }

  private setPersistedWorkspaceEnrollments(accountKey: string, workspaceIds: string[]) {
    const { [accountKey]: _previous, ...rest } = this.getEnrollmentsByAccount();
    this.app.storeManager.set(
      'gatewayWorkspaceEnrollmentsByAccount',
      workspaceIds.length > 0 ? { ...rest, [accountKey]: workspaceIds } : rest,
    );
  }

  private persistWorkspaceEnrollment(accountKey: string, workspaceId: string) {
    const current = this.getPersistedWorkspaceEnrollments(accountKey);
    if (current.includes(workspaceId)) return;
    this.setPersistedWorkspaceEnrollments(accountKey, [...current, workspaceId]);
  }

  private removePersistedWorkspaceEnrollment(accountKey: string, workspaceId: string) {
    const current = this.getPersistedWorkspaceEnrollments(accountKey);
    if (!current.includes(workspaceId)) return;
    this.setPersistedWorkspaceEnrollments(
      accountKey,
      current.filter((id) => id !== workspaceId),
    );
  }

  private getLegacyWorkspaceEnrollments(): string[] {
    const stored = this.app.storeManager.get('gatewayWorkspaceEnrollments');
    return Array.isArray(stored) ? stored.filter((id) => typeof id === 'string') : [];
  }

  private removeLegacyWorkspaceEnrollment(workspaceId: string) {
    const current = this.getLegacyWorkspaceEnrollments();
    if (!current.includes(workspaceId)) return;
    const rest = current.filter((id) => id !== workspaceId);
    if (rest.length > 0) this.app.storeManager.set('gatewayWorkspaceEnrollments', rest);
    else this.app.storeManager.delete('gatewayWorkspaceEnrollments');
  }

  /** Move a pre-scoping record to the account the server confirmed owns it. */
  private adoptLegacyWorkspaceEnrollment(accountKey: string, workspaceId: string) {
    this.persistWorkspaceEnrollment(accountKey, workspaceId);
    this.removeLegacyWorkspaceEnrollment(workspaceId);
  }

  // ─── Auth Expired / Failed Handling ───

  /**
   * Refresh the user token and rebuild the personal connection for the same
   * login. A failed refresh settles on `disconnected` with the reason and waits
   * for the next user action or app start.
   */
  private async handleAuthExpired(client: GatewayClient) {
    if (this.client !== client) return;
    const generation = this.generation;
    const session = this.session;

    // Retire the expired client; its own teardown no longer speaks for the
    // device, which is reconnecting (a quick refresh stays hidden in the UI).
    this.client = null;
    this.setStatus('reconnecting');
    await client.disconnect();

    if (!this.tokenRefresher) {
      logger.error('No token refresher configured, cannot refresh the access token');
      this.setStatus('disconnected');
      return;
    }

    logger.info('Attempting token refresh before reconnect');
    const result = await this.tokenRefresher();
    // Signed out, switched server or reconnected meanwhile: that path owns the
    // connection now.
    if (this.isStale(generation)) return;

    if (result.success) {
      logger.info('Token refreshed, reconnecting');
      await this.startConnect({ reuse: session ?? undefined });
    } else {
      logger.error('Token refresh failed:', result.error);
      this.connectionError = { code: 'auth_failed', detail: result.error };
      this.setStatus('disconnected');
    }
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
   * that yields another rejected token (revoked grant, clock skew) from
   * looping; that second rejection is surfaced as a retryable error.
   */
  private async handleAuthFailed(client: GatewayClient, reason: string) {
    // A replaced or signed-out client's late verdict: not this connection's.
    if (this.client !== client) return;
    logger.warn(`Device gateway rejected the credential: ${reason}`);

    if (this.authRecoveryAttempted) {
      logger.error(
        `Authentication failed again after a token refresh (${reason}); staying disconnected until the next connect`,
      );
      this.connectionError = { code: 'auth_failed', detail: reason };
      this.setStatus('disconnected');
      return;
    }

    this.authRecoveryAttempted = true;
    logger.warn('Attempting token refresh before reconnect...');
    await this.handleAuthExpired(client);
  }

  private isSameSession(a: GatewaySession, b: GatewaySession) {
    return (
      a.serverKey === b.serverKey &&
      a.accountKey === b.accountKey &&
      a.endpoint.url === b.endpoint.url
    );
  }

  /** Whether work started for `session` may still act on the live connection. */
  private isCurrentSession(session: GatewaySession) {
    return this.session !== null && this.isSameSession(this.session, session);
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

  private async collectSystemInfo(): Promise<DeviceSystemInfo> {
    const { getShellInfo } = await import('@lobechat/local-file-shell/shell');
    return {
      supportedTools: ['lobe-computer-use'],
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
    if (status === 'connected') void this.metricsSampler?.sampler.flush();
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
    // The reason only means something once the attempt has ended.
    const error = status === 'disconnected' ? this.connectionError : null;
    if (this.displayedStatus === status && this.displayedError === error) return;
    this.displayedStatus = status;
    this.displayedError = error;
    this.app.browserManager.broadcastToAllWindows(
      'gatewayConnectionStatusChanged',
      this.getDisplayedState(),
    );
  }

  // ─── Gateway Address ───

  /**
   * Resolve the gateway for `serverUrl`, first match wins:
   *   1. `DEVICE_GATEWAY_URL` (dev: a local `wrangler dev` gateway), whatever
   *      its value
   *   2. the address saved in settings (`gatewayUrl`), unless it is the official
   *      gateway itself
   *   3. the address this server advertises
   *   4. the official gateway, when the server answered without one
   * The server is asked only for 3–4. A failed discovery is reported, never
   * replaced by the default: that would send this server's token elsewhere.
   */
  private async resolveEndpoint(serverUrl: string): Promise<DeviceGatewayResolutionWithDefault> {
    const controller = new AbortController();
    this.discoveryAbort = controller;
    try {
      return await resolveDeviceGatewayEndpoint({
        discover: () => discoverDeviceGateway(serverUrl, controller.signal),
        manualUrl: this.getSavedGatewayUrl(),
        officialGatewayUrl: OFFICIAL_DEVICE_GATEWAY_URL,
        override: getDesktopEnv().DEVICE_GATEWAY_URL,
      });
    } finally {
      if (this.discoveryAbort === controller) this.discoveryAbort = null;
    }
  }

  /**
   * The address saved in settings, or `undefined` when none is. Older installs
   * persisted the official gateway as a default, and choosing it is the same as
   * choosing nothing, so that exact value reads as unset: the server's own
   * address, then the official gateway, apply.
   */
  private getSavedGatewayUrl(): string | undefined {
    const saved = this.app.storeManager.get('gatewayUrl');
    if (typeof saved !== 'string' || saved.trim() === '') return undefined;
    return saved === OFFICIAL_DEVICE_GATEWAY_URL ? undefined : saved;
  }

  /** The current server, the address saved in settings, and what the live connection uses. */
  async getEndpointInfo(): Promise<GatewayEndpointInfo> {
    const serverUrl = await this.serverUrlProvider?.();
    const serverKey = serverUrl ? deviceGatewayServerKey(serverUrl) : undefined;
    if (!serverUrl || !serverKey) return { manualUrl: this.getSavedGatewayUrl() };

    const session = this.session?.serverKey === serverKey ? this.session : null;
    return {
      endpoint: session ? { ...session.endpoint } : undefined,
      manualUrl: this.getSavedGatewayUrl(),
      serverUrl,
    };
  }

  /**
   * Save (or clear, with `null`) the gateway address in settings. It beats
   * whatever the server advertises. Saving the official gateway clears it:
   * that is what the desktop uses anyway when the server advertises nothing.
   *
   * @returns whether the live connection depends on it, i.e. should reconnect
   *   for the change to take effect.
   */
  async setManualGatewayUrl(
    url: string | null,
  ): Promise<SetGatewayManualUrlResult & { affectsConnection?: boolean }> {
    const normalized = url === null || url.trim() === '' ? null : normalizeDeviceGatewayUrl(url);
    if (normalized === undefined) return { error: 'invalid_url', success: false };

    if (normalized === null || normalized === OFFICIAL_DEVICE_GATEWAY_URL) {
      this.app.storeManager.delete('gatewayUrl');
      logger.info('Cleared the saved device gateway address');
    } else {
      this.app.storeManager.set('gatewayUrl', normalized);
      logger.info('Saved a device gateway address');
    }

    // Only DEVICE_GATEWAY_URL outranks a saved address.
    return {
      affectsConnection: this.session?.endpoint.source !== 'override',
      savedUrl: this.getSavedGatewayUrl(),
      success: true,
    };
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
