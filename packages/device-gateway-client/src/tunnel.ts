import { Buffer } from 'node:buffer';

import type { GatewayClientLogger } from './client';
import type {
  TunnelClientFrame,
  TunnelOpenMessage,
  TunnelRequestHead,
  TunnelServerFrame,
} from './types';
import { TUNNEL_CHUNK_SIZE, TUNNEL_FLOW_WINDOW } from './types';

/**
 * Device half of the HTTP tunnel: turns the gateway's tunnel frames into a real
 * HTTP request against a loopback port on this machine and streams the response
 * back frame by frame.
 *
 * The gateway owns the browser-facing HTTP semantics (auth, ingress URLs,
 * header sanitising) and pins the target host, so this side only has to be a
 * faithful, well-paced HTTP client.
 */

/** Only loopback targets are servable — defence in depth behind the gateway's pin. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

/**
 * Response headers that describe the *upstream* transfer and no longer hold
 * once the body has been decoded and re-framed. `content-encoding` matters
 * most: `fetch` transparently gunzips, so forwarding it would hand the browser
 * decoded bytes labelled as compressed.
 */
const RESPONSE_HEADER_DENYLIST = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const noopLogger: GatewayClientLogger = {
  debug: () => {},
  error: () => {},
  info: () => {},
  warn: () => {},
};

export interface DeviceTunnelHostOptions {
  /** Injectable for tests; defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
  logger?: GatewayClientLogger;
  /** Tunnels served at once. Extra opens are rejected rather than queued. */
  maxConcurrent?: number;
  /** Sends a frame up the device WebSocket. */
  send: (frame: TunnelClientFrame) => void;
}

interface TunnelConnection {
  abort: AbortController;
  /** Upload finished: the gateway sent its fin frame. */
  bodyFin: boolean;
  /** True for methods that carry no body, whose data frames are dropped. */
  bodyless: boolean;
  /** Request-body chunks received but not yet handed to `fetch`. */
  bodyQueue: Uint8Array[];
  /** Parked `pull` waiting for the next request-body chunk. */
  bodyWaiters: (() => void)[];
  closed: boolean;
  connId: string;
  /** Set once `tunnel_open_ack` has gone out, so failures switch to `tunnel_close`. */
  headSent: boolean;
  seq: number;
  /** Response bytes sent but not yet acked by the gateway. */
  unacked: number;
  /** Parked senders waiting for the flow window to refill. */
  waiters: (() => void)[];
}

const describeError = (error: unknown): string => {
  if (error && typeof error === 'object') {
    const { cause, code, message } = error as { cause?: unknown; code?: string; message?: string };
    const causeCode =
      cause && typeof cause === 'object' ? (cause as { code?: string }).code : undefined;
    return code ?? causeCode ?? message ?? 'TUNNEL_ERROR';
  }
  return String(error ?? 'TUNNEL_ERROR');
};

export class DeviceTunnelHost {
  private connections = new Map<string, TunnelConnection>();
  private fetchImpl: typeof fetch;
  private logger: GatewayClientLogger;
  private maxConcurrent: number;
  private send: (frame: TunnelClientFrame) => void;

  constructor(options: DeviceTunnelHostOptions) {
    this.fetchImpl = options.fetchImpl ?? ((...args) => globalThis.fetch(...args));
    this.logger = options.logger ?? noopLogger;
    this.maxConcurrent = options.maxConcurrent ?? 32;
    this.send = options.send;
  }

  get activeCount(): number {
    return this.connections.size;
  }

  handleFrame(frame: TunnelServerFrame): void {
    switch (frame.type) {
      case 'tunnel_open': {
        this.handleOpen(frame);
        return;
      }
      case 'tunnel_data': {
        const conn = this.connections.get(frame.connId);
        if (!conn || conn.closed) return;
        if (frame.data) {
          const bytes = Buffer.from(frame.data, 'base64');
          if (conn.bodyless) {
            // Nothing will ever consume these, so ack now: an unrefilled window
            // would stall the gateway's pump for the rest of the request.
            this.send({ bytes: bytes.byteLength, connId: frame.connId, type: 'tunnel_ack' });
          } else {
            // Queued, not acked. The ack is the gateway's permission to send
            // more, so it has to mean "consumed by the origin", not "buffered
            // here" — otherwise a slow local handler lets an upload accumulate
            // in this process without bound.
            conn.bodyQueue.push(new Uint8Array(bytes));
          }
        }
        if (frame.fin) conn.bodyFin = true;
        this.wakeBody(conn);
        return;
      }
      case 'tunnel_ack': {
        this.ack(frame.connId, frame.bytes);
        return;
      }
      case 'tunnel_close': {
        this.closeConnection(frame.connId, frame.reason ?? 'PEER_CLOSED', false);
        return;
      }
      default: {
        return;
      }
    }
  }

  /** Abort every in-flight tunnel, e.g. when the device socket drops. */
  closeAll(reason: string): void {
    for (const connId of this.connections.keys()) {
      this.closeConnection(connId, reason, false);
    }
  }

  // ─── internals ───

  private handleOpen(frame: TunnelOpenMessage): void {
    const { connId, head, target } = frame;
    if (this.connections.has(connId)) return;

    if (!LOOPBACK_HOSTS.has(target.host)) {
      this.send({
        connId,
        error: 'TUNNEL_TARGET_NOT_LOOPBACK',
        ok: false,
        type: 'tunnel_open_ack',
      });
      return;
    }
    if (this.connections.size >= this.maxConcurrent) {
      this.send({ connId, error: 'TUNNEL_LIMIT_REACHED', ok: false, type: 'tunnel_open_ack' });
      return;
    }

    const method = head.method.toUpperCase();
    const conn: TunnelConnection = {
      abort: new AbortController(),
      bodyFin: false,
      bodyless: method === 'GET' || method === 'HEAD',
      bodyQueue: [],
      bodyWaiters: [],
      closed: false,
      connId,
      headSent: false,
      seq: 0,
      unacked: 0,
      waiters: [],
    };
    this.connections.set(connId, conn);

    // Started eagerly: the gateway streams the request body *after* the open
    // frame, so the body pump must already be attached when it arrives.
    void this.serve(conn, head, target).catch((error) => {
      this.logger.warn(`[tunnel] ${connId} failed: ${describeError(error)}`);
    });
  }

  private async serve(
    conn: TunnelConnection,
    head: TunnelRequestHead,
    target: { host: string; port: number },
  ): Promise<void> {
    const body = conn.bodyless
      ? undefined
      : new ReadableStream<Uint8Array>(
          {
            cancel: () => {
              conn.bodyQueue.length = 0;
              this.wakeBody(conn);
            },
            // `pull` only runs when the HTTP client actually wants more bytes,
            // which is what makes the ack below mean "consumed".
            pull: async (controller) => {
              while (conn.bodyQueue.length === 0 && !conn.bodyFin && !conn.closed) {
                await new Promise<void>((resolve) => conn.bodyWaiters.push(resolve));
              }
              if (conn.closed) throw new Error('TUNNEL_CLOSED');
              const chunk = conn.bodyQueue.shift();
              if (!chunk) {
                controller.close();
                return;
              }
              controller.enqueue(chunk);
              this.send({ bytes: chunk.byteLength, connId: conn.connId, type: 'tunnel_ack' });
            },
          },
          // Nothing is buffered ahead of a read, so backpressure reaches the
          // gateway instead of stopping at this process.
          { highWaterMark: 0 },
        );

    // An IPv6 literal needs brackets or the URL is invalid.
    const authority = target.host.includes(':') ? `[${target.host}]` : target.host;

    try {
      const response = await this.fetchImpl(`http://${authority}:${target.port}${head.path}`, {
        body,
        // Required by undici whenever the body is a stream.
        ...(body ? { duplex: 'half' } : {}),
        headers: head.headers,
        method: head.method.toUpperCase(),
        // A dev server's redirect belongs to the browser, not to this hop.
        redirect: 'manual',
        signal: conn.abort.signal,
      } as RequestInit);

      if (conn.closed) return;

      this.send({
        connId: conn.connId,
        head: { headers: collectResponseHeaders(response.headers), status: response.status },
        ok: true,
        type: 'tunnel_open_ack',
      });
      conn.headSent = true;

      if (response.body) {
        const reader = response.body.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (conn.closed) return;
            await this.sendBodyChunk(conn, value);
          }
        } finally {
          reader.releaseLock();
        }
      }

      if (conn.closed) return;
      conn.seq += 1;
      this.send({ connId: conn.connId, data: '', fin: true, seq: conn.seq, type: 'tunnel_data' });
      this.dropConnection(conn.connId);
    } catch (error) {
      if (conn.closed) return;
      const reason = describeError(error);
      if (conn.headSent) {
        this.send({ connId: conn.connId, reason, type: 'tunnel_close' });
      } else {
        this.send({ connId: conn.connId, error: reason, ok: false, type: 'tunnel_open_ack' });
      }
      this.dropConnection(conn.connId);
    }
  }

  /** Split into protocol-sized frames and pace them against the flow window. */
  private async sendBodyChunk(conn: TunnelConnection, chunk: Uint8Array): Promise<void> {
    for (let offset = 0; offset < chunk.byteLength; offset += TUNNEL_CHUNK_SIZE) {
      const slice = chunk.subarray(offset, offset + TUNNEL_CHUNK_SIZE);
      while (conn.unacked >= TUNNEL_FLOW_WINDOW && !conn.closed) {
        await new Promise<void>((resolve) => conn.waiters.push(resolve));
      }
      if (conn.closed) return;
      conn.seq += 1;
      conn.unacked += slice.byteLength;
      this.send({
        connId: conn.connId,
        data: Buffer.from(slice.buffer, slice.byteOffset, slice.byteLength).toString('base64'),
        seq: conn.seq,
        type: 'tunnel_data',
      });
    }
  }

  /** Gateway acked delivered bytes — refill the window and wake parked senders. */
  private ack(connId: string, bytes: number): void {
    const conn = this.connections.get(connId);
    if (!conn) return;
    conn.unacked = Math.max(0, conn.unacked - bytes);
    this.wake(conn);
  }

  private closeConnection(connId: string, reason: string, notify: boolean): void {
    const conn = this.connections.get(connId);
    if (!conn) return;
    conn.closed = true;
    conn.abort.abort();
    conn.bodyQueue.length = 0;
    this.wakeBody(conn);
    this.wake(conn);
    this.connections.delete(connId);
    if (notify) this.send({ connId, reason, type: 'tunnel_close' });
  }

  private dropConnection(connId: string): void {
    const conn = this.connections.get(connId);
    if (!conn) return;
    conn.closed = true;
    this.wake(conn);
    this.wakeBody(conn);
    this.connections.delete(connId);
  }

  private wake(conn: TunnelConnection): void {
    const waiters = conn.waiters;
    conn.waiters = [];
    for (const waiter of waiters) waiter();
  }

  private wakeBody(conn: TunnelConnection): void {
    const waiters = conn.bodyWaiters;
    conn.bodyWaiters = [];
    for (const waiter of waiters) waiter();
  }
}

/**
 * Flatten response headers, keeping every `set-cookie` separate (the Headers
 * API folds them into one comma-joined value, which breaks cookie parsing).
 */
const collectResponseHeaders = (headers: Headers): [string, string][] => {
  const out: [string, string][] = [];
  headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (RESPONSE_HEADER_DENYLIST.has(lower) || lower === 'set-cookie') return;
    out.push([name, value]);
  });
  const setCookies = headers.getSetCookie?.() ?? [];
  for (const cookie of setCookies) out.push(['set-cookie', cookie]);
  return out;
};
