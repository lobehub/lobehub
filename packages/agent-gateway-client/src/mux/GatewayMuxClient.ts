import type {
  AgentStreamEvent,
  AgentStreamSessionCompletion,
  ConnectionStatus,
  SessionStatus,
  TerminalSessionStatus,
} from '../types';
import type {
  GatewayMuxClientEvents,
  GatewayMuxClientOptions,
  GatewayMuxStatus,
  MuxClientMessage,
  MuxOperationMessage,
  MuxServerMessage,
  MuxToolResultMessage,
  OperationSubscribeOptions,
  OperationSubscription,
  OperationSubscriptionEvents,
  ToolResultPayload,
} from './types';

// ─── Constants ───

const DEFAULT_HEARTBEAT_INTERVAL = 30_000; // 30s
const INITIAL_RECONNECT_DELAY = 1000; // 1s
const MAX_RECONNECT_DELAY = 30_000; // 30s
const MAX_MISSED_HEARTBEATS = 3;
const MAX_CONSECUTIVE_AUTH_FAILURES = 3;
const TOOL_RESULT_TTL = 120_000; // 120s
const AUTH_CLOSE_CODE = 4401;
/** Must match the hub's WebSocketRequestResponsePair byte-for-byte. */
const HEARTBEAT_WIRE = '{"type":"heartbeat"}';

const TERMINAL_STATUSES = new Set<SessionStatus>(['completed', 'error', 'interrupted']);

const isTerminalStatus = (status?: SessionStatus): status is TerminalSessionStatus =>
  !!status && TERMINAL_STATUSES.has(status);

const randomClientId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// ─── Listener map (browser-compatible, no node:events) ───

type Listener = (...args: any[]) => void;

class ListenerMap {
  private listeners = new Map<string, Set<Listener>>();

  constructor(private readonly tag: string) {}

  on(event: string, listener: Listener): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  emit(event: string, ...args: unknown[]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(...args);
      } catch (error) {
        console.error(`[${this.tag}] Error in ${event} listener:`, error);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

// ─── Operation subscription ───

/**
 * One operation's view over the shared socket. Owns the per-op sequence
 * cursor (dedup + resubscribe cursor) and the v1-compatible terminal
 * semantics: a terminal signal emits `session_complete`, then the
 * subscription ends itself and emits `disconnected`.
 */
class OperationSubscriptionImpl implements OperationSubscription {
  readonly operationId: string;
  readonly executor: boolean;
  private _active = true;
  private _status: ConnectionStatus = 'connecting';
  private _lastEventId: string;
  private lastSeq: number;
  private readonly listeners: ListenerMap;

  constructor(
    private readonly mux: GatewayMuxClient,
    operationId: string,
    options: OperationSubscribeOptions,
  ) {
    this.operationId = operationId;
    this.executor = options.executor ?? false;
    this._lastEventId = options.lastEventId ?? '';
    this.lastSeq = Number(this._lastEventId) || 0;
    this.listeners = new ListenerMap(`GatewayMuxClient:${operationId}`);
  }

  get active(): boolean {
    return this._active;
  }

  get lastEventId(): string {
    return this._lastEventId;
  }

  get status(): ConnectionStatus {
    return this._status;
  }

  on<K extends keyof OperationSubscriptionEvents>(
    event: K,
    listener: OperationSubscriptionEvents[K],
  ): () => void {
    return this.listeners.on(event, listener as Listener);
  }

  sendToolResult(result: ToolResultPayload): boolean {
    if (!this._active) return false;
    return this.mux.sendForSubscription(this, {
      ...result,
      operationId: this.operationId,
      type: 'tool_result',
    });
  }

  sendInterrupt(): boolean {
    if (!this._active) return false;
    return this.mux.sendForSubscription(this, { operationId: this.operationId, type: 'interrupt' });
  }

  sendToolConfirmation(toolCallId: string, approved: boolean): boolean {
    if (!this._active) return false;
    return this.mux.sendForSubscription(this, {
      approved,
      operationId: this.operationId,
      toolCallId,
      type: 'tool_confirmation',
    });
  }

  sendUserInput(requestId: string, content: string): boolean {
    if (!this._active) return false;
    return this.mux.sendForSubscription(this, {
      content,
      operationId: this.operationId,
      requestId,
      type: 'user_input',
    });
  }

  unsubscribe(): void {
    this.end();
  }

  // ─── Called by the mux ───

  /** @internal */
  emit<K extends keyof OperationSubscriptionEvents>(
    event: K,
    ...args: Parameters<OperationSubscriptionEvents[K]>
  ): void {
    if (!this._active) return;
    this.listeners.emit(event, ...args);
  }

  /** @internal The hub rejected the subscription or the token was refused. */
  fail(reason: string): void {
    if (!this._active) return;
    this.listeners.emit('auth_failed', reason);
    this.end();
  }

  /** @internal */
  handleMessage(message: MuxOperationMessage): void {
    if (!this._active) return;

    // Per-op numeric dedup: the hub may deliver an event twice across a
    // reconnect (replay + a live copy that raced the resubscribe).
    if ('id' in message) {
      const seq = Number(message.id);
      if (Number.isFinite(seq)) {
        if (seq <= this.lastSeq) return;
        this.lastSeq = seq;
        this._lastEventId = message.id;
      }
    }

    switch (message.type) {
      case 'agent_event': {
        const agentEvent: AgentStreamEvent = message.event;
        // A member's mirrored terminal must not end the supervisor's
        // subscription — only THIS op's terminal (or one with no operationId,
        // legacy gateway) is terminal here. Mirrors v1 exactly.
        const isOwnTerminal =
          (agentEvent.type === 'agent_runtime_end' || agentEvent.type === 'error') &&
          (!agentEvent.operationId || agentEvent.operationId === this.operationId);
        this.listeners.emit('agent_event', agentEvent);
        if (isOwnTerminal) this.finish({ source: 'agent_event' });
        break;
      }

      case 'session_complete': {
        this.finish({ source: 'raw_session_complete' });
        break;
      }

      case 'status_change': {
        this.listeners.emit('status_change', message.status);
        if (isTerminalStatus(message.status)) {
          this.finish({ source: 'status_change', status: message.status });
        }
        break;
      }

      case 'resume_complete': {
        this.listeners.emit('resume_complete', {
          gap: message.gap,
          pending: message.pending,
          status: message.status,
        });
        // `pending` = the op DO has not seen `init` yet; the hub replays later.
        // Non-terminal status = the run is alive, keep streaming. Never guess
        // completion from silence (see v1 AgentStreamClient).
        if (!message.pending && isTerminalStatus(message.status)) {
          this.finish({ source: 'resume_status', status: message.status });
        }
        break;
      }

      case 'tool_confirmation_request': {
        this.listeners.emit('tool_confirmation_request', message);
        break;
      }

      case 'input_request': {
        this.listeners.emit('input_request', message);
        break;
      }

      case 'subscribe_failed': {
        this.fail(message.reason);
        break;
      }

      case 'error': {
        this.listeners.emit('error', new Error(`${message.code}: ${message.message}`));
        break;
      }
    }
  }

  /** @internal Connection-level status fan-out. */
  notifyStatus(status: ConnectionStatus): void {
    if (!this._active || this._status === status) return;
    this._status = status;
    this.listeners.emit('status_changed', status);
  }

  // ─── Internals ───

  private finish(completion: AgentStreamSessionCompletion): void {
    if (!this._active) return;
    this.listeners.emit('session_complete', completion);
    this.end();
  }

  private end(): void {
    if (!this._active) return;
    this._active = false;
    this.mux.removeSubscription(this);
    if (this._status !== 'disconnected') {
      this._status = 'disconnected';
      this.listeners.emit('status_changed', 'disconnected');
    }
    this.listeners.emit('disconnected');
    this.listeners.clear();
  }
}

// ─── GatewayMuxClient ───

/**
 * One WebSocket per user (protocol v2). Every operation is multiplexed over
 * it via `subscribe` / `unsubscribe`; the hub replays each op's missed events
 * (from the per-op `lastEventId`) before `resume_complete`, so subscriptions
 * emit in arrival order with no client-side resume buffering.
 *
 * Protocol reference: packages/agent-gateway-client/PROTOCOL_V2.md §4, §6.
 */
/**
 * Linear-time trailing-slash strip (a `/\/+$/` regex is flagged as polynomial
 * ReDoS on untrusted input by CodeQL, and the gateway URL comes from server
 * config).
 */
const trimTrailingSlashes = (value: string): string => {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47 /* '/' */) end--;
  return value.slice(0, end);
};

const stripHttpScheme = (value: string): string => {
  if (value.startsWith('https://')) return value.slice('https://'.length);
  if (value.startsWith('http://')) return value.slice('http://'.length);
  return value;
};

export class GatewayMuxClient {
  private ws: WebSocket | null = null;
  private _status: GatewayMuxStatus = 'disconnected';
  private intentionalDisconnect = false;
  private idleCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private connectGeneration = 0;
  private connectInFlight = false;
  private connectWaiters: Array<{ reject: (error: Error) => void; resolve: () => void }> = [];

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private missedHeartbeats = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private consecutiveAuthFailures = 0;
  private browserListenersInstalled = false;

  private readonly subscriptions = new Map<string, Set<OperationSubscriptionImpl>>();
  private toolResultQueue: Array<{
    at: number;
    message: MuxToolResultMessage;
    subscription: OperationSubscriptionImpl;
  }> = [];
  private readonly listeners = new ListenerMap('GatewayMuxClient');

  private readonly gatewayUrl: string;
  private readonly getToken: () => Promise<string>;
  private readonly clientId: string;
  private readonly autoReconnect: boolean;
  private readonly heartbeatIntervalMs: number;
  private readonly keepAlive: boolean;

  constructor(options: GatewayMuxClientOptions) {
    this.gatewayUrl = options.gatewayUrl;
    this.getToken = options.getToken;
    this.clientId = options.clientId ?? randomClientId();
    this.autoReconnect = options.autoReconnect ?? true;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL;
    this.keepAlive = options.keepAlive ?? false;
  }

  // ─── Public API ───

  get status(): GatewayMuxStatus {
    return this._status;
  }

  on<K extends keyof GatewayMuxClientEvents>(
    event: K,
    listener: GatewayMuxClientEvents[K],
  ): () => void {
    return this.listeners.on(event, listener as Listener);
  }

  /**
   * Open the socket (idempotent). Resolves once the hub's `ready` arrives;
   * rejects if `disconnect()` is called or auth gives up before that.
   */
  connect(): Promise<void> {
    this.clearIdleClose();
    if (this._status === 'connected') return Promise.resolve();
    this.intentionalDisconnect = false;
    this.installBrowserListeners();
    const promise = new Promise<void>((resolve, reject) => {
      this.connectWaiters.push({ reject, resolve });
    });
    // A pending backoff timer already owns the next attempt; don't bypass it.
    if (!this.ws && !this.connectInFlight && !this.reconnectTimer) void this.doConnect();
    return promise;
  }

  /**
   * Close the socket and stop reconnecting. Subscriptions are kept and are
   * resubscribed on the next `connect()`; the owner decides their lifetime.
   */
  disconnect(): void {
    this.intentionalDisconnect = true;
    this.connectGeneration++;
    this.connectInFlight = false;
    this.cleanup();
    this.setStatus('disconnected');
    this.broadcastStatus('disconnected');
    this.rejectWaiters(new Error('GatewayMuxClient disconnected'));
    this.listeners.emit('disconnected');
  }

  /**
   * Subscribe to one operation's stream. Connects the socket if needed; the
   * `subscribe` message is (re)sent whenever the socket becomes ready.
   */
  subscribe(operationId: string, options: OperationSubscribeOptions = {}): OperationSubscription {
    this.clearIdleClose();
    const subscription = new OperationSubscriptionImpl(this, operationId, options);
    let set = this.subscriptions.get(operationId);
    if (!set) {
      set = new Set();
      this.subscriptions.set(operationId, set);
    }
    set.add(subscription);

    if (this.isReady()) {
      this.sendSubscribe(subscription);
    } else {
      subscription.notifyStatus(this.reconnectTimer ? 'reconnecting' : 'connecting');
      this.connect().catch(() => {
        // Surfaced through `auth_failed` / `error` listeners; nothing to do here.
      });
    }
    return subscription;
  }

  // ─── Subscription callbacks (internal) ───

  /** @internal */
  removeSubscription(subscription: OperationSubscriptionImpl): void {
    const set = this.subscriptions.get(subscription.operationId);
    if (!set?.delete(subscription)) return;
    this.toolResultQueue = this.toolResultQueue.filter(
      (entry) => entry.subscription !== subscription,
    );
    if (set.size === 0) {
      this.subscriptions.delete(subscription.operationId);
      this.sendMessage({ operationId: subscription.operationId, type: 'unsubscribe' });
    }
    // A lazily-dialed mux has no reason to stay up once nothing is subscribed;
    // the next `subscribe` redials. `keepAlive` muxes are owned by the page.
    if (this.isIdle()) this.scheduleIdleClose();
  }

  /** Nothing subscribed, nobody awaiting `connect()`, and not asked to stay up. */
  private isIdle(): boolean {
    return !this.keepAlive && this.subscriptions.size === 0 && this.connectWaiters.length === 0;
  }

  /**
   * Close on the next tick, not synchronously: an unsubscribe immediately
   * followed by a subscribe (the adapter's `reconnect()`) must reuse the socket.
   */
  private scheduleIdleClose(): void {
    if (this.idleCloseTimer) return;
    this.idleCloseTimer = setTimeout(() => {
      this.idleCloseTimer = null;
      if (this.isIdle()) this.disconnect();
    }, 0);
  }

  private clearIdleClose(): void {
    if (this.idleCloseTimer) {
      clearTimeout(this.idleCloseTimer);
      this.idleCloseTimer = null;
    }
  }

  /** @internal Send now, or queue `tool_result` (TTL 120s) until the socket is ready. */
  sendForSubscription(subscription: OperationSubscriptionImpl, message: MuxClientMessage): boolean {
    if (this.sendMessage(message)) return true;
    if (message.type === 'tool_result') {
      this.toolResultQueue.push({ at: Date.now(), message, subscription });
      return true;
    }
    return false;
  }

  // ─── Connection logic ───

  private async doConnect(): Promise<void> {
    if (this.intentionalDisconnect || this.ws || this.connectInFlight) return;
    const generation = ++this.connectGeneration;
    this.connectInFlight = true;
    this.clearReconnectTimer();
    this.setStatus('connecting');

    let token: string;
    try {
      token = await this.getToken();
    } catch (error) {
      if (generation !== this.connectGeneration) return;
      this.connectInFlight = false;
      this.listeners.emit(
        'error',
        error instanceof Error ? error : new Error('Failed to obtain gateway token'),
      );
      this.handleConnectionLost();
      return;
    }
    // `disconnect()` or a newer attempt superseded this one while awaiting.
    if (generation !== this.connectGeneration) return;
    this.connectInFlight = false;

    try {
      const ws = new WebSocket(this.buildWsUrl(token));
      ws.onmessage = this.handleMessage;
      ws.onclose = this.handleClose;
      ws.onerror = this.handleError;
      this.ws = ws;
    } catch (error) {
      console.error('[GatewayMuxClient] Failed to create WebSocket:', error);
      this.handleConnectionLost();
    }
  }

  private buildWsUrl(token: string): string {
    const query = `token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(this.clientId)}`;
    // If the URL already has a ws/wss protocol, use it directly
    if (this.gatewayUrl.startsWith('ws://') || this.gatewayUrl.startsWith('wss://')) {
      return `${trimTrailingSlashes(this.gatewayUrl)}/v2/ws?${query}`;
    }
    // Otherwise convert http(s) to ws(s)
    const wsProtocol = this.gatewayUrl.startsWith('https') ? 'wss' : 'ws';
    const host = trimTrailingSlashes(stripHttpScheme(this.gatewayUrl));
    return `${wsProtocol}://${host}/v2/ws?${query}`;
  }

  // ─── WebSocket event handlers ───

  private handleMessage = (event: MessageEvent): void => {
    let message: MuxServerMessage;
    try {
      message = JSON.parse(event.data as string) as MuxServerMessage;
    } catch (error) {
      console.error('[GatewayMuxClient] Failed to parse message:', error);
      return;
    }

    switch (message.type) {
      case 'ready': {
        this.reconnectAttempt = 0;
        this.consecutiveAuthFailures = 0;
        this.setStatus('connected');
        this.startHeartbeat();
        // Subscribe before flushing: the hub rejects op messages from a
        // connection that is not subscribed to the op.
        for (const set of this.subscriptions.values()) {
          for (const subscription of set) this.sendSubscribe(subscription);
        }
        this.flushToolResults();
        this.listeners.emit('connected');
        this.resolveWaiters();
        break;
      }

      case 'heartbeat_ack': {
        this.missedHeartbeats = 0;
        break;
      }

      case 'op_lifecycle': {
        this.listeners.emit('lifecycle', message);
        break;
      }

      case 'error': {
        const { operationId } = message;
        if (operationId && this.subscriptions.has(operationId)) {
          this.route({ ...message, operationId });
        } else {
          this.listeners.emit('error', new Error(`${message.code}: ${message.message}`));
        }
        break;
      }

      default: {
        this.route(message);
      }
    }
  };

  private route(message: MuxOperationMessage): void {
    const set = this.subscriptions.get(message.operationId);
    if (!set) return;
    // Copy: a terminal message removes the subscription mid-iteration.
    for (const subscription of set) subscription.handleMessage(message);
  }

  private handleClose = (event: CloseEvent | undefined): void => {
    this.stopHeartbeat();
    this.ws = null;

    if (this.intentionalDisconnect) return;

    if (event?.code === AUTH_CLOSE_CODE) {
      this.consecutiveAuthFailures++;
      if (this.consecutiveAuthFailures >= MAX_CONSECUTIVE_AUTH_FAILURES) {
        this.failAuth(event.reason || 'auth_failed');
        return;
      }
      // Token refused: refresh it (getToken runs on every attempt) and retry now.
      this.handleConnectionLost(0);
      return;
    }

    this.handleConnectionLost();
  };

  private handleError = (): void => {
    // The close event will follow; just emit the error
    this.listeners.emit('error', new Error('Gateway WebSocket error'));
  };

  private handleConnectionLost(delayOverride?: number): void {
    // An idle lazy mux that loses its socket just stays down (see isIdle).
    if (this.autoReconnect && !this.intentionalDisconnect && !this.isIdle()) {
      this.scheduleReconnect(delayOverride);
      return;
    }
    this.setStatus('disconnected');
    this.broadcastStatus('disconnected');
    this.rejectWaiters(new Error('Gateway connection lost'));
    this.listeners.emit('disconnected');
  }

  private failAuth(reason: string): void {
    this.cleanup();
    // Detach the subscriptions before failing them: `fail` unsubscribes, and an
    // idle-close from `removeSubscription` must not race this teardown.
    const failed = [...this.subscriptions.values()].flatMap((set) => [...set]);
    this.subscriptions.clear();
    for (const subscription of failed) subscription.fail(reason);
    this.toolResultQueue = [];
    this.setStatus('disconnected');
    this.rejectWaiters(new Error(`Gateway auth failed: ${reason}`));
    this.listeners.emit('disconnected');
  }

  // ─── Heartbeat ───

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.missedHeartbeats = 0;
    this.heartbeatTimer = setInterval(() => {
      this.missedHeartbeats++;
      if (this.missedHeartbeats > MAX_MISSED_HEARTBEATS) {
        console.error(
          `[GatewayMuxClient] Missed ${this.missedHeartbeats} heartbeat acks, forcing reconnect`,
        );
        this.stopHeartbeat();
        this.closeWebSocket();
        this.handleConnectionLost();
        return;
      }
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(HEARTBEAT_WIRE);
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ─── Reconnection (exponential backoff with full jitter) ───

  private scheduleReconnect(delayOverride?: number): void {
    this.clearReconnectTimer();

    const cap = Math.min(MAX_RECONNECT_DELAY, INITIAL_RECONNECT_DELAY * 2 ** this.reconnectAttempt);
    const delay = delayOverride ?? Math.floor(Math.random() * cap);
    this.reconnectAttempt++;

    this.setStatus('connecting');
    this.broadcastStatus('reconnecting');
    this.listeners.emit('reconnecting', delay);
    for (const set of this.subscriptions.values()) {
      for (const subscription of set) subscription.emit('reconnecting', delay);
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.doConnect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /** `online` / tab-visible: skip the remaining backoff and dial now. */
  private reconnectNow = (): void => {
    if (this.intentionalDisconnect || !this.autoReconnect) return;
    if (this.ws || this.connectInFlight) return;
    if (!this.keepAlive && this.subscriptions.size === 0 && this.connectWaiters.length === 0)
      return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    this.clearReconnectTimer();
    void this.doConnect();
  };

  private installBrowserListeners(): void {
    if (this.browserListenersInstalled) return;
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('online', this.reconnectNow);
    }
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', this.reconnectNow);
    }
    this.browserListenersInstalled = true;
  }

  private removeBrowserListeners(): void {
    if (!this.browserListenersInstalled) return;
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('online', this.reconnectNow);
    }
    if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('visibilitychange', this.reconnectNow);
    }
    this.browserListenersInstalled = false;
  }

  // ─── Status ───

  private setStatus(status: GatewayMuxStatus): void {
    if (this._status === status) return;
    this._status = status;
    this.listeners.emit('status_changed', status);
  }

  private broadcastStatus(status: ConnectionStatus): void {
    for (const set of this.subscriptions.values()) {
      for (const subscription of set) subscription.notifyStatus(status);
    }
  }

  private resolveWaiters(): void {
    const waiters = this.connectWaiters;
    this.connectWaiters = [];
    for (const waiter of waiters) waiter.resolve();
  }

  private rejectWaiters(error: Error): void {
    const waiters = this.connectWaiters;
    this.connectWaiters = [];
    for (const waiter of waiters) waiter.reject(error);
  }

  // ─── Helpers ───

  private isReady(): boolean {
    return this._status === 'connected' && this.ws?.readyState === WebSocket.OPEN;
  }

  private sendSubscribe(subscription: OperationSubscriptionImpl): void {
    const sent = this.sendMessage({
      ...(subscription.executor ? { executor: true } : {}),
      ...(subscription.lastEventId ? { lastEventId: subscription.lastEventId } : {}),
      operationId: subscription.operationId,
      type: 'subscribe',
    });
    if (!sent) return;
    subscription.notifyStatus('connected');
    subscription.emit('connected');
  }

  private flushToolResults(): void {
    const queue = this.toolResultQueue;
    this.toolResultQueue = [];
    const now = Date.now();
    for (const entry of queue) {
      if (now - entry.at > TOOL_RESULT_TTL || !entry.subscription.active) continue;
      if (!this.sendMessage(entry.message)) this.toolResultQueue.push(entry);
    }
  }

  private sendMessage(data: MuxClientMessage): boolean {
    if (this.isReady()) {
      this.ws!.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  private closeWebSocket(): void {
    if (!this.ws) return;
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

  private cleanup(): void {
    this.clearIdleClose();
    this.stopHeartbeat();
    this.clearReconnectTimer();
    this.removeBrowserListeners();
    this.closeWebSocket();
  }
}
