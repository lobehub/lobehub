// ─── Device Info ───

/** A single live gateway WebSocket connection belonging to a device. */
export interface DeviceConnection {
  /** Freeform routing label, e.g. `desktop` / `desktop-dev` / `cli` / `cli-dev`. */
  channel?: string;
  connectedAt: number;
  /** Per-install random UUID — the gateway's stale-connection dedupe key. */
  connectionId: string;
}

/**
 * A device as surfaced by the gateway `/api/device/devices` endpoint. Keyed by
 * the stable `deviceId` (one entry per physical machine); the live WS sessions
 * are nested under `channels` so a single device can hold several at once
 * (e.g. desktop app + `lh connect` both connected).
 */
export interface GatewayDevice {
  channels: DeviceConnection[];
  /** Most recent channel's connect time. */
  connectedAt: number;
  deviceId: string;
  hostname: string;
  platform: string;
}

export interface DeviceSystemInfo {
  arch: string;
  desktopPath: string;
  documentsPath: string;
  downloadsPath: string;
  homePath: string;
  musicPath: string;
  picturesPath: string;
  userDataPath: string;
  videosPath: string;
  workingDirectory: string;
}

// ─── WebSocket Protocol Messages (mirrors the device-gateway service's types) ───

// Client → Server
export interface AuthMessage {
  serverUrl?: string;
  token: string;
  tokenType?: 'apiKey' | 'jwt' | 'serviceToken';
  type: 'auth';
}

export interface HeartbeatMessage {
  type: 'heartbeat';
}

export interface ToolCallResponseMessage {
  requestId: string;
  result: {
    content: string;
    error?: string;
    success: boolean;
  };
  type: 'tool_call_response';
}

export interface MessageApiResponseMessage {
  requestId: string;
  result: {
    content: string;
    error?: string;
    success: boolean;
  };
  type: 'message_api_response';
}

// Server → Client
export interface HeartbeatAckMessage {
  type: 'heartbeat_ack';
}

export interface AuthSuccessMessage {
  type: 'auth_success';
}

export interface AuthFailedMessage {
  reason: string;
  type: 'auth_failed';
}

export interface AuthExpiredMessage {
  type: 'auth_expired';
}

export interface ToolCallRequestMessage {
  /** Operation that triggered the call, propagated by the gateway for tracing. */
  operationId?: string;
  requestId: string;
  /** Per-call timeout (ms) the gateway forwards; clients pass it through. */
  timeout?: number;
  toolCall: {
    apiName: string;
    arguments: string;
    identifier: string;
  };
  type: 'tool_call_request';
}

export interface MessageApiRequestMessage {
  api: {
    apiName: string;
    payload: Record<string, unknown>;
    platform: string;
  };
  requestId: string;
  type: 'message_api_request';
}

// Server → Client
export interface SystemInfoRequestMessage {
  requestId: string;
  type: 'system_info_request';
}

// Client → Server
export interface SystemInfoResponseMessage {
  requestId: string;
  result: {
    success: boolean;
    systemInfo: DeviceSystemInfo;
  };
  type: 'system_info_response';
}

/** Server → Client: request the desktop to spawn `lh hetero exec`. */
export interface AgentRunRequestMessage {
  agentType: string;
  cwd?: string;
  jwt: string;
  operationId: string;
  prompt: string;
  resumeSessionId?: string;
  /**
   * Static context injected before the user prompt (workspace conventions,
   * conversation history on resume). The desktop sends it to `lh hetero exec`
   * as the first text block of a content-block array. Optional — omitted for
   * older servers that don't build a device-specific context.
   */
  systemContext?: string;
  topicId: string;
  type: 'agent_run_request';
}

/** Client → Server: acknowledgement for an agent_run_request. */
export interface AgentRunAckMessage {
  operationId: string;
  reason?: string;
  status: 'accepted' | 'rejected';
  type: 'agent_run_ack';
}

export type ClientMessage =
  | AgentRunAckMessage
  | AuthMessage
  | HeartbeatMessage
  | MessageApiResponseMessage
  | SystemInfoResponseMessage
  | ToolCallResponseMessage;
export type ServerMessage =
  | AgentRunRequestMessage
  | AuthExpiredMessage
  | AuthFailedMessage
  | AuthSuccessMessage
  | HeartbeatAckMessage
  | MessageApiRequestMessage
  | SystemInfoRequestMessage
  | ToolCallRequestMessage;

// ─── Client Types ───

export type ConnectionStatus =
  | 'authenticating'
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | 'reconnecting';

export interface GatewayClientEvents {
  agent_run_request: (request: AgentRunRequestMessage) => void;
  auth_expired: () => void;
  auth_failed: (reason: string) => void;
  connected: () => void;
  disconnected: () => void;
  error: (error: Error) => void;
  heartbeat_ack: () => void;
  message_api_request: (request: MessageApiRequestMessage) => void;
  reconnecting: (delay: number) => void;
  status_changed: (status: ConnectionStatus) => void;
  system_info_request: (request: SystemInfoRequestMessage) => void;
  tool_call_request: (request: ToolCallRequestMessage) => void;
}
