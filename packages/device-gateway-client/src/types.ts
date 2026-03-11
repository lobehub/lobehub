// ─── Device Info ───

export interface DeviceAttachment {
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

// ─── WebSocket Protocol Messages (mirrors apps/device-gateway/src/types.ts) ───

// Client → Server
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
  requestId: string;
  toolCall: {
    apiName: string;
    arguments: string;
    identifier: string;
  };
  type: 'tool_call_request';
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

// ─── Client Types ───

export type ConnectionStatus =
  | 'authenticating'
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | 'reconnecting';

export interface GatewayClientEvents {
  auth_expired: () => void;
  auth_failed: (reason: string) => void;
  connected: () => void;
  disconnected: () => void;
  error: (error: Error) => void;
  heartbeat_ack: () => void;
  reconnecting: (delay: number) => void;
  status_changed: (status: ConnectionStatus) => void;
  system_info_request: (request: SystemInfoRequestMessage) => void;
  tool_call_request: (request: ToolCallRequestMessage) => void;
}
