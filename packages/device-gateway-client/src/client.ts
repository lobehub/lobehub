import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import os from 'node:os';

import WebSocket from 'ws';

import type {
  ClientMessage,
  ConnectionStatus,
  GatewayClientEvents,
  ServerMessage,
  SystemInfoRequestMessage,
  SystemInfoResponseMessage,
  ToolCallRequestMessage,
  ToolCallResponseMessage,
} from './types';

// ─── Constants ───

const DEFAULT_GATEWAY_URL = 'https://device-gateway.lobehub.com';
const HEARTBEAT_INTERVAL = 30_000; // 30s
const INITIAL_RECONNECT_DELAY = 1000; // 1s
const MAX_RECONNECT_DELAY = 30_000; // 30s

// ─── Logger Interface ───

export interface GatewayClientLogger {
  debug: (msg: string, ...args: unknown[]) => void;
  error: (msg: string, ...args: unknown[]) => void;
  info: (msg: string, ...args: unknown[]) => void;
  warn: (msg: string, ...args: unknown[]) => void;
}

const noopLogger: GatewayClientLogger = {
  debug: () => {},
  error: () => {},
  info: () => {},
  warn: () => {},
};

export interface GatewayClientOptions {
  /** Auto-reconnect on disconnection (default: true) */
  autoReconnect?: boolean;
  deviceId?: string;
  gatewayUrl?: string;
  logger?: GatewayClientLogger;
  serverUrl?: string;
  token: string;
  tokenType?: 'apiKey' | 'jwt' | 'serviceToken';
  userId?: string;
}

export class GatewayClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = INITIAL_RECONNECT_DELAY;
  private status: ConnectionStatus = 'disconnected';
  private intentionalDisconnect = false;
  private deviceId: string;
  private gatewayUrl: string;
  private token: string;
  private tokenType?: 'apiKey' | 'jwt' | 'serviceToken';
  private userId?: string;
  private serverUrl?: string;
  private logger: GatewayClientLogger;
  private autoReconnect: boolean;

  constructor(options: GatewayClientOptions) {
    super();
    this.token = options.token;
    this.tokenType = options.tokenType;
    this.gatewayUrl = options.gatewayUrl || DEFAULT_GATEWAY_URL;
    this.deviceId = options.deviceId || randomUUID();
    this.serverUrl = options.serverUrl;
    this.userId = options.userId;
    this.logger = options.logger || noopLogger;
    this.autoReconnect = options.autoReconnect ?? true;
  }

  // ─── Public API ───

  get connectionStatus(): ConnectionStatus {
    return this.status;
  }

  get currentDeviceId(): string {
    return this.deviceId;
  }

  override on<K extends keyof GatewayClientEvents>(
    event: K,
    listener: GatewayClientEvents[K],
  ): this {
    return super.on(event, listener);
  }

  override emit<K extends keyof GatewayClientEvents>(
    event: K,
    ...args: Parameters<GatewayClientEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }

  async connect(): Promise<void> {
    if (this.status === 'connected' || this.status === 'connecting') {
      return;
    }
    this.intentionalDisconnect = false;
    this.doConnect();
  }

  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true;
    this.cleanup();
    this.setStatus('disconnected');
  }

  sendToolCallResponse(response: Omit<ToolCallResponseMessage, 'type'>): void {
    this.sendMessage({
      ...response,
      type: 'tool_call_response',
    });
  }

  sendSystemInfoResponse(response: Omit<SystemInfoResponseMessage, 'type'>): void {
    this.sendMessage({
      ...response,
      type: 'system_info_response',
    });
  }

  // ─── Connection Logic ───

  private doConnect() {
    this.clearReconnectTimer();

    this.setStatus('connecting');

    try {
      const wsUrl = this.buildWsUrl();
      this.logger.debug(`Connecting to: ${wsUrl}`);

      const ws = new WebSocket(wsUrl);

      ws.on('open', this.handleOpen);
      ws.on('message', this.handleMessage);
      ws.on('close', this.handleClose);
      ws.on('error', this.handleError);

      this.ws = ws;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to create WebSocket:', msg);
      this.setStatus('disconnected');
      if (this.autoReconnect) {
        this.scheduleReconnect();
      } else {
        this.emit('disconnected');
      }
    }
  }

  private buildWsUrl(): string {
    const wsProtocol = this.gatewayUrl.startsWith('https') ? 'wss' : 'ws';
    const host = this.gatewayUrl.replace(/^https?:\/\//, '');
    const params = new URLSearchParams({
      deviceId: this.deviceId,
      hostname: os.hostname(),
      platform: process.platform,
    });

    // Service token mode: pass userId in query
    if (this.userId) {
      params.set('userId', this.userId);
    }

    return `${wsProtocol}://${host}/ws?${params.toString()}`;
  }

  // ─── WebSocket Event Handlers ───

  private handleOpen = () => {
    this.logger.info('WebSocket connected, sending auth...');
    this.reconnectDelay = INITIAL_RECONNECT_DELAY;
    this.setStatus('authenticating');

    // Send token as first message instead of in URL
    this.sendMessage({
      serverUrl: this.serverUrl,
      token: this.token,
      tokenType: this.tokenType,
      type: 'auth',
    });
  };

  private handleMessage = (data: WebSocket.Data) => {
    try {
      const message = JSON.parse(String(data)) as ServerMessage;

      switch (message.type) {
        case 'auth_success': {
          this.logger.info('Authentication successful');
          this.setStatus('connected');
          this.startHeartbeat();
          this.emit('connected');
          break;
        }

        case 'auth_failed': {
          const reason = (message as any).reason || 'Unknown reason';
          this.logger.error(`Authentication failed: ${reason}`);
          this.emit('auth_failed', reason);
          this.disconnect();
          break;
        }

        case 'heartbeat_ack': {
          this.emit('heartbeat_ack');
          break;
        }

        case 'tool_call_request': {
          this.emit('tool_call_request', message as ToolCallRequestMessage);
          break;
        }

        case 'system_info_request': {
          this.emit('system_info_request', message as SystemInfoRequestMessage);
          break;
        }

        case 'auth_expired': {
          this.logger.warn('Received auth_expired from gateway');
          this.emit('auth_expired');
          break;
        }

        default: {
          this.logger.warn('Unknown message type:', (message as any).type);
        }
      }
    } catch (error) {
      this.logger.error('Failed to parse WebSocket message:', error as string);
    }
  };

  private handleClose = (code: number, reason: Buffer) => {
    this.logger.info(`WebSocket closed: code=${code} reason=${reason.toString()}`);
    this.stopHeartbeat();
    this.ws = null;

    if (!this.intentionalDisconnect && this.autoReconnect) {
      this.setStatus('reconnecting');
      this.scheduleReconnect();
    } else {
      this.setStatus('disconnected');
      this.emit('disconnected');
    }
  };

  private handleError = (error: Error) => {
    this.logger.error('WebSocket error:', error.message);
    this.emit('error', error);
  };

  // ─── Heartbeat ───

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.sendMessage({ type: 'heartbeat' });
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ─── Reconnection (exponential backoff) ───

  private scheduleReconnect() {
    this.clearReconnectTimer();

    const delay = this.reconnectDelay;
    this.logger.info(`Scheduling reconnect in ${delay}ms`);
    this.emit('reconnecting', delay);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.logger.info('Attempting reconnect');
      this.doConnect();
    }, delay);

    // Exponential backoff: 1s → 2s → 4s → 8s → ... → 30s
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ─── Status ───

  private setStatus(status: ConnectionStatus) {
    if (this.status === status) return;

    this.status = status;
    this.emit('status_changed', status);
  }

  // ─── Helpers ───

  private sendMessage(data: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private closeWebSocket() {
    if (this.ws) {
      this.ws.removeAllListeners();

      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000, 'Client disconnect');
      }
      this.ws = null;
    }
  }

  private cleanup() {
    this.stopHeartbeat();
    this.clearReconnectTimer();
    this.closeWebSocket();
  }
}
