export interface Env {
  DEVICE_GATEWAY: DurableObjectNamespace;
  JWKS_PUBLIC_KEY: string;
  SERVICE_TOKEN: string;
}

// ─── Device Info ───

export interface DeviceAttachment {
  connectedAt: number;
  deviceId: string;
  hostname: string;
  platform: string;
}

// ─── WebSocket Protocol Messages ───

// Desktop → CF
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

// CF → Desktop
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

export type ClientMessage = HeartbeatMessage | ToolCallResponseMessage;
export type ServerMessage = AuthExpiredMessage | HeartbeatAckMessage | ToolCallRequestMessage;
