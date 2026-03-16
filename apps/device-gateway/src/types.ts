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
  token: string;
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

export type ClientMessage =
  | AuthMessage
  | HeartbeatMessage
  | SystemInfoResponseMessage
  | ToolCallResponseMessage;
export type ServerMessage =
  | AuthExpiredMessage
  | AuthFailedMessage
  | AuthSuccessMessage
  | HeartbeatAckMessage
  | SystemInfoRequestMessage
  | ToolCallRequestMessage;
