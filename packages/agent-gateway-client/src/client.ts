import type {
  AgentStreamClientEvents,
  AgentStreamClientOptions,
  AgentStreamEvent,
  ClientMessage,
  ConnectionStatus,
  ServerMessage,
  ToolResultMessage,
} from './types';

// ─── Constants ───

const HEARTBEAT_INTERVAL = 30_000; // 30s
const INITIAL_RECONNECT_DELAY = 1000; // 1s
const MAX_RECONNECT_DELAY = 30_000; // 30s
const MAX_MISSED_HEARTBEATS = 3;
const RESUME_FLUSH_DELAY = 500; // 500ms debounce after last resume event
const RESUME_TIMEOUT = 3000; // 3s: if no events after resume request, session is already done

// ─── Typed Event Emitter (browser-compatible, no node:events) ───

type Listener = (...args: any[]) => void;

class TypedEmitter {
  private listeners = new Map<string, Set<Listener>>();

  on(event: string, listener: Listener): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
  }

  off(event: string, listener: Listener): void {
    this.listeners.get(event)?.delete(listener);
  }

  protected emit(event: string, ...args: unknown[]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(...args);
      } catch (error) {
        console.error(`[AgentStreamClient] Error in ${event} listener:`, error);
      }
    }
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}

// ─── AgentStreamClient ───

/**
 * Browser-compatible WebSocket client for receiving Agent execution events
 * from the Agent Gateway. Supports auto-reconnect with event replay via lastEventId.
 *
 * Protocol reference: apps/cli/src/utils/agentStream.ts
 */
export class AgentStreamClient extends TypedEmitter {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = INITIAL_RECONNECT_DELAY;
  private missedHeartbeats = 0;
  private _status: ConnectionStatus = 'disconnected';
  private intentionalDisconnect = false;
  private lastEventId = '';
  private sessionEnded = false;

  // Resume buffering: when reconnecting with empty lastEventId, buffer events
  // until resume replay completes, then deduplicate and emit in order.
  private resumeBuffer: Array<{ event: AgentStreamEvent; id?: string }> = [];
  private resumeMode = false;
  private resumeFlushTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly gatewayUrl: string;
  private readonly operationId: string;
  private readonly autoReconnect: boolean;
  private readonly resumeOnConnect: boolean;
  private token: string;

  constructor(options: AgentStreamClientOptions) {
    super();
    this.gatewayUrl = options.gatewayUrl;
    this.operationId = options.operationId;
    this.token = options.token;
    this.autoReconnect = options.autoReconnect ?? true;
    this.resumeOnConnect = options.resumeOnConnect ?? false;
  }

  // ─── Public API ───

  get connectionStatus(): ConnectionStatus {
    return this._status;
  }

  /**
   * Subscribe to typed events.
   */
  override on<K extends keyof AgentStreamClientEvents>(
    event: K,
    listener: AgentStreamClientEvents[K],
  ): void {
    super.on(event, listener as Listener);
  }

  /**
   * Unsubscribe from typed events.
   */
  override off<K extends keyof AgentStreamClientEvents>(
    event: K,
    listener: AgentStreamClientEvents[K],
  ): void {
    super.off(event, listener as Listener);
  }

  /**
   * Connect to the Agent Gateway WebSocket.
   */
  connect(): void {
    if (this._status === 'connected' || this._status === 'connecting') return;
    this.intentionalDisconnect = false;
    this.sessionEnded = false;
    this.doConnect();
  }

  /**
   * Disconnect and stop auto-reconnect.
   */
  disconnect(): void {
    this.intentionalDisconnect = true;
    this.cleanup();
    this.setStatus('disconnected');
    this.emit('disconnected');
  }

  /**
   * Send an interrupt command to stop the running agent.
   */
  sendInterrupt(): void {
    this.sendMessage({ type: 'interrupt' });
  }

  /**
   * Send a tool execution result back to the server.
   * Correlated by toolCallId; the server's agent loop is blocked on BLPOP until this arrives.
   * Returns true when the payload was handed off to the WebSocket, false when no live socket
   * is available (caller should fall back to server-side BLPOP timeout).
   */
  sendToolResult(result: Omit<ToolResultMessage, 'type'>): boolean {
    return this.sendMessage({ ...result, type: 'tool_result' });
  }

  /**
   * Update the auth token (e.g. after JWT refresh). Call connect() or wait for auto-reconnect.
   */
  updateToken(token: string): void {
    this.token = token;
  }

  // ─── Connection Logic ───

  private doConnect(): void {
    this.clearReconnectTimer();
    this.setStatus('connecting');

    try {
      const wsUrl = this.buildWsUrl();
      const ws = new WebSocket(wsUrl);

      ws.onopen = this.handleOpen;
      ws.onmessage = this.handleMessage;
      ws.onclose = this.handleClose;
      ws.onerror = this.handleError;

      this.ws = ws;
    } catch (error) {
      console.error('[AgentStreamClient] Failed to create WebSocket:', error);
      this.setStatus('disconnected');
      if (this.autoReconnect && !this.sessionEnded) {
        this.scheduleReconnect();
      }
    }
  }

  private buildWsUrl(): string {
    // If the URL already has a ws/wss protocol, use it directly
    if (this.gatewayUrl.startsWith('ws://') || this.gatewayUrl.startsWith('wss://')) {
      const base = this.gatewayUrl.replace(/\/+$/, '');
      return `${base}/ws?operationId=${encodeURIComponent(this.operationId)}`;
    }
    // Otherwise convert http(s) to ws(s)
    const wsProtocol = this.gatewayUrl.startsWith('https') ? 'wss' : 'ws';
    const host = this.gatewayUrl.replace(/^https?:\/\//, '');
    return `${wsProtocol}://${host}/ws?operationId=${encodeURIComponent(this.operationId)}`;
  }

  // ─── WebSocket Event Handlers ───

  private handleOpen = (): void => {
    this.reconnectDelay = INITIAL_RECONNECT_DELAY;
    this.setStatus('authenticating');
    this.sendMessage({ token: this.token, type: 'auth' });
  };

  private handleMessage = (event: MessageEvent): void => {
    try {
      const message = JSON.parse(event.data as string) as ServerMessage;

      switch (message.type) {
        case 'auth_success': {
          this.setStatus('connected');
          this.startHeartbeat();

          // Enter resume mode only for explicit reconnect scenarios (page reload).
          // Buffer all events until resume replay completes, then deduplicate and emit.
          // This is NOT enabled for normal first-connect to avoid delaying live streaming.
          if (this.resumeOnConnect && !this.lastEventId) {
            this.resumeMode = true;
            this.resumeBuffer = [];

            // Safety timeout: if no events arrive after resume, the session has already
            // completed and the DO has nothing to replay. Exit resume mode and signal completion.
            this.resumeFlushTimer = setTimeout(() => {
              if (this.resumeMode && this.resumeBuffer.length === 0) {
                this.resumeMode = false;
                this.sessionEnded = true;
                this.emit('session_complete');
                this.disconnect();
              }
            }, RESUME_TIMEOUT);
          }

          // Request all buffered events (covers events pushed before WS connected)
          this.sendMessage({ lastEventId: this.lastEventId, type: 'resume' });
          this.emit('connected');
          break;
        }

        case 'auth_failed': {
          this.emit('auth_failed', message.reason);
          this.disconnect();
          break;
        }

        case 'heartbeat_ack': {
          this.missedHeartbeats = 0;
          break;
        }

        case 'agent_event': {
          const agentEvent: AgentStreamEvent = message.event;
          if (message.id) this.lastEventId = message.id;

          if (this.resumeMode) {
            // Buffer events during resume — will be deduplicated and emitted after replay
            this.resumeBuffer.push({ event: agentEvent, id: message.id });
            this.scheduleResumeFlush();

            // Terminal events still end the session even in resume mode
            if (agentEvent.type === 'agent_runtime_end' || agentEvent.type === 'error') {
              this.sessionEnded = true;
              this.flushResumeBuffer();
              this.disconnect();
            }
            break;
          }

          this.emit('agent_event', agentEvent);

          // Terminal events — session is done, no need to reconnect
          if (agentEvent.type === 'agent_runtime_end' || agentEvent.type === 'error') {
            this.sessionEnded = true;
            this.disconnect();
          }
          break;
        }

        case 'session_complete': {
          this.sessionEnded = true;
          // Flush any buffered resume events before disconnecting
          if (this.resumeMode) {
            this.flushResumeBuffer();
          }
          this.emit('session_complete');
          this.disconnect();
          break;
        }
      }
    } catch (error) {
      console.error('[AgentStreamClient] Failed to parse message:', error);
    }
  };

  private handleClose = (): void => {
    this.stopHeartbeat();
    this.ws = null;

    if (!this.intentionalDisconnect && this.autoReconnect && !this.sessionEnded) {
      this.setStatus('reconnecting');
      this.scheduleReconnect();
    } else if (this._status !== 'disconnected') {
      this.setStatus('disconnected');
      this.emit('disconnected');
    }
  };

  private handleError = (): void => {
    // The close event will follow; just emit the error
    this.emit('error', new Error(`WebSocket error for operation ${this.operationId}`));
  };

  // ─── Heartbeat ───

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.missedHeartbeats = 0;
    this.heartbeatTimer = setInterval(() => {
      this.missedHeartbeats++;
      if (this.missedHeartbeats > MAX_MISSED_HEARTBEATS) {
        console.error(
          `[AgentStreamClient] Missed ${this.missedHeartbeats} heartbeat acks, forcing reconnect`,
        );
        this.closeWebSocket();
        this.stopHeartbeat();
        if (this.autoReconnect && !this.sessionEnded) {
          this.setStatus('reconnecting');
          this.scheduleReconnect();
        } else {
          this.setStatus('disconnected');
          this.emit('disconnected');
        }
        return;
      }
      this.sendMessage({ type: 'heartbeat' });
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ─── Reconnection (exponential backoff) ───

  private scheduleReconnect(): void {
    this.clearReconnectTimer();

    const delay = this.reconnectDelay;
    this.emit('reconnecting', delay);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.doConnect();
    }, delay);

    // Exponential backoff: 1s → 2s → 4s → ... → 30s
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ─── Status ───

  private setStatus(status: ConnectionStatus): void {
    if (this._status === status) return;
    this._status = status;
    this.emit('status_changed', status);
  }

  // ─── Resume Buffering ───

  /**
   * Schedule a debounced flush of the resume buffer.
   * Resume replay events arrive in rapid succession; once there's a 500ms gap,
   * we consider the replay done and flush the deduplicated buffer.
   */
  private scheduleResumeFlush(): void {
    if (this.resumeFlushTimer) clearTimeout(this.resumeFlushTimer);
    this.resumeFlushTimer = setTimeout(() => {
      this.flushResumeBuffer();
    }, RESUME_FLUSH_DELAY);
  }

  /**
   * Deduplicate buffered events by event ID and emit them in order.
   */
  private flushResumeBuffer(): void {
    if (!this.resumeMode) return;
    this.resumeMode = false;

    if (this.resumeFlushTimer) {
      clearTimeout(this.resumeFlushTimer);
      this.resumeFlushTimer = null;
    }

    // Deduplicate by event ID, keeping the first occurrence (from resume replay)
    const seen = new Set<string>();
    const deduped: AgentStreamEvent[] = [];

    for (const { event, id } of this.resumeBuffer) {
      const key = id || `${event.type}_${event.stepIndex}_${event.timestamp}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(event);
      }
    }

    this.resumeBuffer = [];

    // Emit deduplicated events in order
    for (const event of deduped) {
      this.emit('agent_event', event);
    }
  }

  // ─── Helpers ───

  private sendMessage(data: ClientMessage): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  private closeWebSocket(): void {
    if (this.ws) {
      // Remove handlers to prevent handleClose from firing after manual close
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;

      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000, 'Client disconnect');
      }
      this.ws = null;
    }
  }

  private cleanup(): void {
    this.stopHeartbeat();
    this.clearReconnectTimer();
    this.closeWebSocket();
    if (this.resumeFlushTimer) {
      clearTimeout(this.resumeFlushTimer);
      this.resumeFlushTimer = null;
    }
    this.resumeMode = false;
    this.resumeBuffer = [];
  }
}
