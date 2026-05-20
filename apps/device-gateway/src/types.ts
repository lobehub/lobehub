export interface Env {
  DEVICE_GATEWAY: DurableObjectNamespace;
  JWKS_PUBLIC_KEY: string;
  SERVICE_TOKEN: string;
}

// ─── Device Info ───

export interface DeviceAttachment {
  authDeadline?: number;
  authenticated: boolean;
  connectedAt: number;
  deviceId: string;
  hostname: string;
  lastHeartbeat: number;
  platform: string;
}

// ─── WebSocket Protocol Messages ───

// Desktop → CF
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

export interface SystemInfoResponseMessage {
  requestId: string;
  result: DeviceSystemInfo;
  type: 'system_info_response';
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

// CF → Desktop
export interface AuthSuccessMessage {
  type: 'auth_success';
}

export interface AuthFailedMessage {
  reason: string;
  type: 'auth_failed';
}

export interface HeartbeatAckMessage {
  type: 'heartbeat_ack';
}

export interface AuthExpiredMessage {
  type: 'auth_expired';
}

export interface ToolCallRequestMessage {
  requestId: string;
  toolCall: {
    apiName: string;
    arguments: string;
    identifier: string;
  };
  type: 'tool_call_request';
}

export interface SystemInfoRequestMessage {
  requestId: string;
  type: 'system_info_request';
}

/**
 * CF → Desktop: request the desktop to spawn `lh hetero exec` for a
 * heterogeneous agent run.  The JWT is operation-scoped (4h TTL) and only
 * grants `heteroIngest` / `heteroFinish` for this operationId.
 */
export interface AgentRunRequestMessage {
  agentType: 'claude-code' | 'codex';
  /** Working directory to pass to `lh hetero exec --cwd`. */
  cwd?: string;
  /** Operation-scoped JWT signed by the server — inject as LOBEHUB_JWT env. */
  jwt: string;
  operationId: string;
  /** Plain-text prompt to pass via `lh hetero exec --prompt`. */
  prompt: string;
  /** Native CLI session id for `lh hetero exec --resume`. */
  resumeSessionId?: string;
  topicId: string;
  type: 'agent_run_request';
}

/** Desktop → CF: acknowledgement for an `agent_run_request`. */
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
  | SystemInfoResponseMessage
  | ToolCallResponseMessage;
export type ServerMessage =
  | AgentRunRequestMessage
  | AuthExpiredMessage
  | AuthFailedMessage
  | AuthSuccessMessage
  | HeartbeatAckMessage
  | SystemInfoRequestMessage
  | ToolCallRequestMessage;
