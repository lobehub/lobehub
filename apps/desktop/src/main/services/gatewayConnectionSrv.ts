import { randomUUID } from 'node:crypto';
import os from 'node:os';

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
import { deriveDeviceId } from '@lobechat/device-identity';
import type { GatewayConnectionStatus } from '@lobechat/electron-client-ipc';
import { app, powerSaveBlocker } from 'electron';

import { isDev } from '@/const/env';
import { getDesktopEnv } from '@/env';
import { createLogger } from '@/utils/logger';
import { getDesktopUserAgent } from '@/utils/user-agent';

import { ServiceModule } from './index';

const logger = createLogger('services:GatewayConnectionSrv');

const DEFAULT_GATEWAY_URL = 'https://device-gateway.lobehub.com';

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
  (apiName: string, args: unknown): Promise<ToolCallResult>;
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
    return { success: true };
  }

  private setupClientEvents(client: GatewayClient) {
    client.on('status_changed', (status) => {
      this.setStatus(status);
    });

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
      logger.warn('Received auth_expired, will reconnect with refreshed token');
      this.handleAuthExpired();
    });

    client.on('error', (error) => {
      logger.error('WebSocket error:', error.message);
    });
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
        result = await this.toolCallHandler(apiName, args);
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
