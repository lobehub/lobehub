import type { AgentRunRequestMessage, GatewayMcpParams } from '@lobechat/device-gateway-client';
import type { IdentitySource } from '@lobechat/device-identity';

/**
 * The contracts of the handlers `GatewayConnectionService` is wired with: the
 * controller injects them, the service calls them as gateway traffic arrives.
 */

/**
 * Result envelope a tool-call handler must return. Mirrors
 * `BuiltinServerRuntimeOutput` so the renderer-side and remote-device paths
 * stay symmetric: `content` is the LLM-facing prompt text; `state` carries the
 * structured payload that downstream persists into `pluginState`.
 */
export interface ToolCallResult {
  content: string;
  error?: unknown;
  state?: unknown;
  success: boolean;
}

export interface MessageApiHandler {
  (platform: string, apiName: string, payload: Record<string, unknown>): Promise<unknown>;
}

export interface ToolCallHandler {
  (identifier: string | undefined, apiName: string, args: unknown): Promise<ToolCallResult>;
}

/**
 * Handler for tunneled stdio MCP calls. Unlike {@link ToolCallHandler} (which
 * keys on `apiName` for builtin local-system tools), this carries the MCP
 * server identity + connection params so the device can spawn the local stdio
 * server and invoke the tool on it.
 */
export interface McpCallHandler {
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
export interface AgentRunHandler {
  (request: AgentRunRequestMessage): Promise<{ reason?: string; status: 'accepted' | 'rejected' }>;
}

/**
 * Handler for generic server-internal device RPCs (e.g. workspace-init scans).
 * Dispatches by `method` name and returns the JSON-serializable result. Distinct
 * from {@link ToolCallHandler} — RPCs are never exposed to the agent.
 */
export interface RpcHandler {
  (method: string, params: unknown): Promise<unknown>;
}

/** The server + credential one connection attempt was resolved against. */
export interface GatewayAuthContext {
  serverUrl: string;
  token: string;
}

/** Runs each time a connection comes up, with the device id it is connected as. */
export interface ConnectedHandler {
  /** `workspaceId`: a workspace share connection, identified by its own device id. */
  (info: { deviceId: string; workspaceId?: string }): Promise<void>;
}

export interface DeviceRegistrar {
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
export interface WorkspaceTokenProvider {
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
export interface WorkspaceDeviceChecker {
  (
    workspaceId: string,
    deviceId: string,
    serverUrl: string,
  ): Promise<WorkspaceDeviceRegistration | undefined>;
}
