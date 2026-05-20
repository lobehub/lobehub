import type { QQApiClient } from './api';
import type {
  QQGatewayHelloData,
  QQGatewayPayload,
  QQGatewayReadyData,
  QQGatewayUrlResponse,
} from './types';
import { QQ_INTENTS, QQ_WS_OP_CODES } from './types';

export type GatewayLogger = (...args: any[]) => void;

// Default no-op logger
const noop: GatewayLogger = () => {};

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 60_000;
const MAX_RECONNECT_ATTEMPTS = 10;

// Heartbeat interval bounds — sanitize values from gateway to avoid unbounded timers
const HEARTBEAT_MIN_INTERVAL_MS = 1_000;
const HEARTBEAT_MAX_INTERVAL_MS = 300_000;
const HEARTBEAT_DEFAULT_INTERVAL_MS = 45_000;

/**
 * Default intents for message-handling bots:
 * - PUBLIC_GUILD_MESSAGES: @bot mentions in public guild channels
 * - DIRECT_MESSAGE: Direct messages
 * - GROUP_AND_C2C_EVENT: Group and C2C (friend) messages
 */
const DEFAULT_INTENTS =
  QQ_INTENTS.PUBLIC_GUILD_MESSAGES | QQ_INTENTS.DIRECT_MESSAGE | QQ_INTENTS.GROUP_AND_C2C_EVENT;

export interface QQGatewayOptions {
  /** AbortSignal to cancel the gateway connection */
  abortSignal?: AbortSignal;
  /** Duration in ms before the connection auto-closes (caller restarts) */
  durationMs?: number;
  /** Bitmask of intents to subscribe to */
  intents?: number;
  /** Optional logger function (defaults to no-op) */
  log?: GatewayLogger;
  /** Shard configuration [shard_id, total_shards] */
  shard?: [number, number];
  /** URL to forward dispatch events to (POST) */
  webhookUrl: string;
}

/**
 * Manages a persistent WebSocket connection to the QQ Bot Gateway.
 *
 * Lifecycle: connect → Hello → Identify → Ready → heartbeat loop + event dispatch.
 * Supports resume on disconnect using stored session_id + seq.
 */
export class QQGatewayConnection {
  private readonly api: QQApiClient;
  private readonly intents: number;
  private readonly log: GatewayLogger;
  private readonly shard: [number, number];
  private readonly webhookUrl: string;
  private readonly abortSignal?: AbortSignal;
  private readonly durationMs?: number;

  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private seq: number | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatAcked = true;
  private reconnectAttempts = 0;
  private gatewayUrl: string | null = null;
  private resumeGatewayUrl: string | null = null;
  private closed = false;
  private openConnectionError: Error | null = null;
  private hasConnected = false;

  constructor(api: QQApiClient, options: QQGatewayOptions) {
    this.api = api;
    this.intents = options.intents ?? DEFAULT_INTENTS;
    this.log = options.log ?? noop;
    this.shard = options.shard ?? [0, 1];
    this.webhookUrl = options.webhookUrl;
    this.abortSignal = options.abortSignal;
    this.durationMs = options.durationMs;
  }

  /**
   * Start the gateway connection. Resolves once the READY event is received.
   * Rejects if the initial connection or identification fails.
   */
  async connect(): Promise<void> {
    if (this.abortSignal?.aborted) return;

    // Fetch gateway URL
    const gatewayInfo: QQGatewayUrlResponse = await this.api.getGatewayUrl();
    this.gatewayUrl = gatewayInfo.url;

    this.log('Gateway URL: %s (shards: %d)', this.gatewayUrl, gatewayInfo.shards ?? 1);

    return this.openConnection(this.gatewayUrl, false);
  }

  /**
   * Gracefully close the gateway connection.
   */
  close(): void {
    this.closed = true;
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close(1000, 'Client shutdown');
      this.ws = null;
    }
  }

  // ---------- Connection Management ----------

  private openConnection(url: string, isResume: boolean): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.abortSignal?.aborted || this.closed) {
        resolve();
        return;
      }

      const ws = new WebSocket(url);
      this.ws = ws;

      let resolved = false;
      this.openConnectionError = null;

      const onAbort = () => {
        this.close();
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };

      this.abortSignal?.addEventListener('abort', onAbort, { once: true });

      ws.addEventListener('open', () => {
        this.log('WebSocket connected (resume=%s)', isResume);
        this.reconnectAttempts = 0;
      });

      ws.addEventListener('message', (event) => {
        const data =
          typeof event.data === 'string'
            ? event.data
            : new TextDecoder().decode(event.data as ArrayBuffer);
        let payload: QQGatewayPayload;
        try {
          payload = JSON.parse(data);
        } catch {
          this.log('Failed to parse gateway message: %s', data);
          return;
        }

        this.handlePayload(payload, isResume, (err?: Error) => {
          if (resolved) return;
          resolved = true;
          if (err) reject(err);
          else resolve();
        });
      });

      ws.addEventListener('close', (event) => {
        this.log('WebSocket closed: code=%d reason=%s', event.code, event.reason);
        this.stopHeartbeat();
        this.abortSignal?.removeEventListener('abort', onAbort);

        if (!resolved) {
          resolved = true;
          const error = this.openConnectionError;
          this.openConnectionError = null;

          if (error) {
            reject(error);
          } else if (this.closed || this.abortSignal?.aborted || this.hasConnected) {
            resolve();
          } else {
            reject(
              new Error(
                `QQ gateway socket closed before ${isResume ? 'RESUMED' : 'READY'}: ` +
                  `code=${event.code} reason=${event.reason || 'unknown'}`,
              ),
            );
          }
        }

        if (this.hasConnected && !this.closed && !this.abortSignal?.aborted) {
          this.attemptReconnect();
        }
      });

      ws.addEventListener('error', (event) => {
        this.log('WebSocket error: %O', event);
        if (!resolved) {
          resolved = true;
          reject(new Error('WebSocket connection failed'));
        }
      });

      // Auto-close after durationMs
      if (this.durationMs) {
        setTimeout(() => {
          if (!this.closed && !this.abortSignal?.aborted) {
            this.log('Duration elapsed (%dms), closing', this.durationMs);
            this.close();
          }
        }, this.durationMs);
      }
    });
  }

  // ---------- Payload Handling ----------

  private handlePayload(
    payload: QQGatewayPayload,
    isResume: boolean,
    onReady: (err?: Error) => void,
  ): void {
    // Track sequence number for heartbeat and resume
    if (payload.s !== undefined && payload.s !== null) {
      this.seq = payload.s;
    }

    switch (payload.op) {
      case QQ_WS_OP_CODES.HELLO: {
        this.handleHello(payload.d as QQGatewayHelloData, isResume);
        break;
      }

      case QQ_WS_OP_CODES.DISPATCH: {
        this.handleDispatch(payload, onReady);
        break;
      }

      case QQ_WS_OP_CODES.HEARTBEAT_ACK: {
        this.heartbeatAcked = true;
        break;
      }

      case QQ_WS_OP_CODES.RECONNECT: {
        this.log('Server requested reconnect');
        this.ws?.close(4000, 'Server reconnect');
        break;
      }

      case QQ_WS_OP_CODES.INVALID_SESSION: {
        const canResume = payload.d === true;
        this.log('Invalid session (canResume=%s)', canResume);
        if (!canResume) {
          // Clear session — must re-identify
          this.sessionId = null;
          this.seq = null;
        }
        this.ws?.close(4000, 'Invalid session');
        break;
      }

      case QQ_WS_OP_CODES.HEARTBEAT: {
        // Server may request an immediate heartbeat
        this.sendHeartbeat();
        break;
      }

      default: {
        this.log('Unhandled OP code: %d', payload.op);
      }
    }
  }

  private handleHello(data: QQGatewayHelloData, isResume: boolean): void {
    // Clamp gateway-provided interval into a safe range to prevent resource exhaustion
    const rawInterval = data.heartbeat_interval;
    const safeInterval = Number.isFinite(rawInterval)
      ? Math.min(Math.max(rawInterval, HEARTBEAT_MIN_INTERVAL_MS), HEARTBEAT_MAX_INTERVAL_MS)
      : HEARTBEAT_DEFAULT_INTERVAL_MS;

    this.log('Hello received, heartbeat_interval=%dms (effective=%dms)', rawInterval, safeInterval);
    this.startHeartbeat(safeInterval);

    if (isResume && this.sessionId) {
      this.sendResume();
    } else {
      this.sendIdentify();
    }
  }

  private handleDispatch(payload: QQGatewayPayload, onReady: (err?: Error) => void): void {
    const eventType = payload.t;

    if (eventType === 'READY') {
      const readyData = payload.d as QQGatewayReadyData;
      this.sessionId = readyData.session_id;
      this.hasConnected = true;
      this.log('Ready: session_id=%s user=%s', this.sessionId, readyData.user?.username);
      onReady();
      return;
    }

    if (eventType === 'RESUMED') {
      this.hasConnected = true;
      this.log('Session resumed');
      onReady();
      return;
    }

    // Forward all other dispatch events to the webhook URL
    this.forwardEvent(payload);
  }

  // ---------- Send Operations ----------

  private sendIdentify(): void {
    this.api
      .getAccessToken()
      .then((token) => {
        const identifyPayload: QQGatewayPayload = {
          d: {
            intents: this.intents,
            properties: {
              $browser: 'lobehub-gateway',
              $device: 'lobehub-gateway',
              $os: 'linux',
            },
            shard: this.shard,
            token: `QQBot ${token}`,
          },
          op: QQ_WS_OP_CODES.IDENTIFY,
        };

        this.send(identifyPayload);
        this.log('Identify sent (intents=%d, shard=%o)', this.intents, this.shard);
      })
      .catch((err) => {
        this.log('Failed to get access token for identify: %O', err);
        this.openConnectionError =
          err instanceof Error ? err : new Error('Failed to get access token for identify');
        this.ws?.close(4000, 'Identify failed');
      });
  }

  private sendResume(): void {
    this.api
      .getAccessToken()
      .then((token) => {
        const resumePayload: QQGatewayPayload = {
          d: {
            seq: this.seq,
            session_id: this.sessionId,
            token: `QQBot ${token}`,
          },
          op: QQ_WS_OP_CODES.RESUME,
        };

        this.send(resumePayload);
        this.log('Resume sent (session_id=%s, seq=%d)', this.sessionId, this.seq);
      })
      .catch((err) => {
        this.log('Failed to get access token for resume: %O', err);
        this.openConnectionError =
          err instanceof Error ? err : new Error('Failed to get access token for resume');
        this.ws?.close(4000, 'Resume failed');
      });
  }

  private sendHeartbeat(): void {
    const heartbeatPayload: QQGatewayPayload = {
      d: this.seq,
      op: QQ_WS_OP_CODES.HEARTBEAT,
    };
    this.send(heartbeatPayload);
  }

  private send(payload: QQGatewayPayload): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  // ---------- Heartbeat ----------

  private startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat();
    this.heartbeatAcked = true;

    // Send first heartbeat after a random jitter (as per spec)
    const jitter = Math.random() * intervalMs;
    setTimeout(() => {
      if (this.closed || this.abortSignal?.aborted) return;
      this.sendHeartbeat();

      this.heartbeatTimer = setInterval(() => {
        if (this.closed || this.abortSignal?.aborted) {
          this.stopHeartbeat();
          return;
        }

        if (!this.heartbeatAcked) {
          this.log('Heartbeat ACK missed — zombie connection, reconnecting');
          this.ws?.close(4000, 'Heartbeat timeout');
          return;
        }

        this.heartbeatAcked = false;
        this.sendHeartbeat();
      }, intervalMs);
    }, jitter);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ---------- Event Forwarding ----------

  private forwardEvent(payload: QQGatewayPayload): void {
    // Construct a webhook-compatible payload:
    // The handleWebhook() expects { op: 0, t: eventType, d: eventData, id, s }
    const webhookPayload = {
      d: payload.d,
      id: payload.id || `gw_${Date.now()}`,
      op: 0,
      s: payload.s,
      t: payload.t,
    };

    fetch(this.webhookUrl, {
      body: JSON.stringify(webhookPayload),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
    }).catch((err) => {
      this.log('Failed to forward event %s to webhook: %O', payload.t, err);
    });
  }

  // ---------- Reconnection ----------

  private attemptReconnect(): void {
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

    setTimeout(() => {
      if (this.closed || this.abortSignal?.aborted) return;

      const canResume = !!this.sessionId;
      const url = canResume && this.resumeGatewayUrl ? this.resumeGatewayUrl : this.gatewayUrl;

      if (!url) {
        this.log('No gateway URL available for reconnect');
        return;
      }

      this.openConnection(url, canResume).catch((err) => {
        this.log('Reconnect failed: %O', err);
      });
    }, delay);
  }
}
