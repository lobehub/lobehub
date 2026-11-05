import type { DingTalkApiClient } from './api';
import { signCallback } from './crypto';
import type { DingTalkStreamAck, DingTalkStreamFrame, DingTalkStreamSubscription } from './types';
import { DINGTALK_STREAM_FRAME_TYPES, DINGTALK_STREAM_TOPICS } from './types';

export type GatewayLogger = (...args: any[]) => void;

const noop: GatewayLogger = () => {};

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 60_000;
const MAX_RECONNECT_ATTEMPTS = 10;

/**
 * The server sends `ping` system frames to keep the stream alive. A socket
 * that stays silent longer than this is treated as dead (half-open TCP) and
 * replaced with a fresh connection.
 */
const DEFAULT_IDLE_TIMEOUT_MS = 180_000;
const IDLE_CHECK_MIN_INTERVAL_MS = 1000;

const FORWARD_TIMEOUT_MS = 30_000;

export const DEFAULT_STREAM_SUBSCRIPTIONS: DingTalkStreamSubscription[] = [
  { topic: DINGTALK_STREAM_TOPICS.BOT_MESSAGE, type: 'CALLBACK' },
];

export interface DingTalkGatewayOptions {
  /** AbortSignal to cancel the gateway connection */
  abortSignal?: AbortSignal;
  /** Client Secret used to sign forwarded events (same scheme as HTTP callback mode) */
  clientSecret: string;
  /** Duration in ms before the connection auto-closes (caller restarts) */
  durationMs?: number;
  /** Close and replace the socket after this long without any frame */
  idleTimeoutMs?: number;
  /** Optional logger function (defaults to no-op) */
  log?: GatewayLogger;
  /** Topics to subscribe to; defaults to robot message callbacks */
  subscriptions?: DingTalkStreamSubscription[];
  /** URL to forward robot message callbacks to (POST) */
  webhookUrl: string;
}

/**
 * DingTalk Stream mode client.
 *
 * Lifecycle: `POST /v1.0/gateway/connections/open` (endpoint + one-shot
 * ticket) → WebSocket `endpoint?ticket=...` → answer `ping`, ACK every
 * callback, forward robot messages to `webhookUrl` → on `disconnect` or socket
 * loss, register again (tickets are single-use) and reconnect with backoff.
 */
export class DingTalkStreamConnection {
  private readonly api: DingTalkApiClient;
  private readonly options: DingTalkGatewayOptions;
  private readonly log: GatewayLogger;
  private readonly idleTimeoutMs: number;

  private ws: WebSocket | null = null;
  private closed = false;
  private hasConnected = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private durationTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private lastFrameAt = 0;
  private onAbort?: () => void;

  constructor(api: DingTalkApiClient, options: DingTalkGatewayOptions) {
    this.api = api;
    this.options = options;
    this.log = options.log ?? noop;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  }

  /**
   * Open the stream. Resolves once the first WebSocket handshake succeeds;
   * rejects when registration or the first handshake fails (bad credentials,
   * Stream mode not enabled, network).
   */
  async connect(): Promise<void> {
    if (this.options.abortSignal?.aborted || this.closed) return;

    this.onAbort = () => this.close();
    this.options.abortSignal?.addEventListener('abort', this.onAbort, { once: true });

    if (this.options.durationMs) {
      this.durationTimer = setTimeout(() => {
        if (!this.closed) {
          this.log('Duration elapsed (%dms), closing', this.options.durationMs);
          this.close();
        }
      }, this.options.durationMs);
    }

    try {
      await this.openConnection();
    } catch (err) {
      this.close();
      throw err;
    }
  }

  /** Gracefully close the stream; no reconnect afterwards. */
  close(): void {
    this.closed = true;
    this.stopIdleWatchdog();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.durationTimer) clearTimeout(this.durationTimer);
    this.reconnectTimer = null;
    this.durationTimer = null;
    if (this.onAbort) {
      this.options.abortSignal?.removeEventListener('abort', this.onAbort);
      this.onAbort = undefined;
    }
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000, 'Client shutdown');
  }

  // ---------- Connection Management ----------

  private get stopped(): boolean {
    return this.closed || !!this.options.abortSignal?.aborted;
  }

  private async openConnection(): Promise<void> {
    const { endpoint, ticket } = await this.api.openStreamConnection(
      this.options.subscriptions ?? DEFAULT_STREAM_SUBSCRIPTIONS,
    );
    if (this.stopped) return;

    const separator = endpoint.includes('?') ? '&' : '?';
    const url = `${endpoint}${separator}ticket=${encodeURIComponent(ticket)}`;
    this.log('Stream endpoint: %s', endpoint);

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      let settled = false;
      const settle = (err?: Error) => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve();
      };

      ws.addEventListener('open', () => {
        if (this.ws !== ws) return;
        this.log('Stream WebSocket connected');
        this.hasConnected = true;
        this.reconnectAttempts = 0;
        this.lastFrameAt = Date.now();
        this.startIdleWatchdog(ws);
        settle();
      });

      ws.addEventListener('message', (event) => {
        if (this.ws !== ws) return;
        this.lastFrameAt = Date.now();
        const raw =
          typeof event.data === 'string'
            ? event.data
            : new TextDecoder().decode(event.data as ArrayBuffer);
        this.handleFrame(ws, raw);
      });

      ws.addEventListener('close', (event) => {
        this.log('Stream WebSocket closed: code=%d reason=%s', event.code, event.reason);
        if (this.ws !== ws && this.ws !== null) return;
        this.ws = null;
        this.stopIdleWatchdog();

        if (!settled) {
          settle(
            this.stopped
              ? undefined
              : new Error(
                  `DingTalk stream socket closed before open: code=${event.code} reason=${
                    event.reason || 'unknown'
                  }`,
                ),
          );
          return;
        }

        if (!this.stopped) this.scheduleReconnect();
      });

      ws.addEventListener('error', (event) => {
        this.log('Stream WebSocket error: %O', event);
        settle(new Error('DingTalk stream WebSocket connection failed'));
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.log('Max reconnect attempts reached (%d), giving up', MAX_RECONNECT_ATTEMPTS);
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * 2 ** (this.reconnectAttempts - 1),
      RECONNECT_MAX_DELAY_MS,
    );
    this.log(
      'Reconnecting in %dms (attempt %d/%d)',
      delay,
      this.reconnectAttempts,
      MAX_RECONNECT_ATTEMPTS,
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.stopped) return;
      // Tickets are single-use, so every reconnect registers again.
      this.openConnection().catch((err) => {
        this.log('Reconnect failed: %O', err);
        this.scheduleReconnect();
      });
    }, delay);
  }

  // ---------- Liveness ----------

  private startIdleWatchdog(ws: WebSocket): void {
    this.stopIdleWatchdog();
    const interval = Math.max(Math.floor(this.idleTimeoutMs / 4), IDLE_CHECK_MIN_INTERVAL_MS);
    this.idleTimer = setInterval(() => {
      if (this.ws !== ws || this.stopped) {
        this.stopIdleWatchdog();
        return;
      }
      if (Date.now() - this.lastFrameAt > this.idleTimeoutMs) {
        this.log('No frame for %dms, replacing the connection', this.idleTimeoutMs);
        ws.close(4000, 'Idle timeout');
      }
    }, interval);
  }

  private stopIdleWatchdog(): void {
    if (this.idleTimer) clearInterval(this.idleTimer);
    this.idleTimer = null;
  }

  // ---------- Frames ----------

  private handleFrame(ws: WebSocket, raw: string): void {
    let frame: DingTalkStreamFrame;
    try {
      frame = JSON.parse(raw);
    } catch {
      this.log('Failed to parse stream frame: %s', raw);
      return;
    }

    const topic = frame.headers?.topic;
    const messageId = frame.headers?.messageId;

    switch (frame.type) {
      case DINGTALK_STREAM_FRAME_TYPES.SYSTEM: {
        if (topic === DINGTALK_STREAM_TOPICS.PING) {
          // Echo `opaque` back unchanged.
          this.ack(ws, messageId, 200, frame.data);
        } else if (topic === DINGTALK_STREAM_TOPICS.DISCONNECT) {
          this.log('Server requested disconnect: %s', frame.data);
          // The server drops TCP ~10s later; reconnect right away instead.
          ws.close(4000, 'Server disconnect');
        } else {
          this.log('System frame: %s', topic);
        }
        return;
      }

      case DINGTALK_STREAM_FRAME_TYPES.CALLBACK: {
        if (topic !== DINGTALK_STREAM_TOPICS.BOT_MESSAGE) {
          this.ack(ws, messageId, 404, JSON.stringify({ response: null }), 'topic not supported');
          return;
        }
        // Robot messages are fire-and-forget: ACK immediately, never block on the agent.
        this.ack(ws, messageId, 200, JSON.stringify({ response: null }));
        this.forwardCallback(frame.data, messageId);
        return;
      }

      case DINGTALK_STREAM_FRAME_TYPES.EVENT: {
        this.ack(ws, messageId, 200, JSON.stringify({ message: 'ignored', status: 'SUCCESS' }));
        return;
      }

      default: {
        this.log('Unknown frame type: %s', (frame as { type?: string }).type);
      }
    }
  }

  private ack(
    ws: WebSocket,
    messageId: string | undefined,
    code: number,
    data: string,
    message = 'OK',
  ): void {
    if (!messageId || ws.readyState !== WebSocket.OPEN) return;
    const ack: DingTalkStreamAck = {
      code,
      data,
      headers: { contentType: 'application/json', messageId },
      message,
    };
    ws.send(JSON.stringify(ack));
  }

  private forwardCallback(data: string, messageId?: string): void {
    const timestamp = String(Date.now());
    fetch(this.options.webhookUrl, {
      body: data,
      headers: {
        'Content-Type': 'application/json',
        'sign': signCallback(timestamp, this.options.clientSecret),
        'timestamp': timestamp,
      },
      method: 'POST',
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    }).catch((err) => {
      this.log('Failed to forward callback %s to webhook: %O', messageId, err);
    });
  }
}
