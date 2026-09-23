import { Buffer } from 'node:buffer';

import WebSocket from 'ws';

import type { GatewayClientLogger } from './client';
import type { LoopbackResolver } from './loopback';
import type {
  TunnelClientFrame,
  TunnelWsCloseMessage,
  TunnelWsDataMessage,
  TunnelWsOpenMessage,
} from './types';
import { TUNNEL_WS_MAX_MESSAGE } from './types';

/**
 * Device half of a WebSocket tunnel: opens `ws://127.0.0.1:<port>` for a
 * browser socket the gateway is holding, and relays messages whole in both
 * directions. This is what a dev server's live reload (Vite/webpack HMR)
 * needs; plain HTTP is handled by `DeviceTunnelHost`.
 */

/** The slice of a `ws` socket this host touches — injectable for tests. */
export interface TunnelUpstreamSocket {
  close: (code?: number, reason?: string) => void;
  on: {
    (event: 'close', listener: (code: number, reason: Buffer) => void): unknown;
    (event: 'error', listener: (error: Error) => void): unknown;
    (event: 'message', listener: (data: Buffer, isBinary: boolean) => void): unknown;
    (event: 'open', listener: () => void): unknown;
  };
  /** Stop reading from the upstream socket (TCP backpressure reaches the app). */
  pause: () => void;
  readonly protocol: string;
  resume: () => void;
  send: (data: Buffer | string) => void;
  terminate: () => void;
}

export type TunnelUpstreamFactory = (url: string, protocols: string[]) => TunnelUpstreamSocket;

const defaultFactory: TunnelUpstreamFactory = (url, protocols) =>
  new WebSocket(url, protocols, {
    handshakeTimeout: 10_000,
    maxPayload: TUNNEL_WS_MAX_MESSAGE,
  }) as unknown as TunnelUpstreamSocket;

/** Close codes a socket may legally send; anything else becomes 1000/1011. */
const sendableCode = (code?: number, fallback = 1000) =>
  code &&
  ((code >= 1000 && code <= 1003) ||
    (code >= 1007 && code <= 1014) ||
    (code >= 3000 && code <= 4999))
    ? code
    : fallback;

/**
 * Relay backpressure. Frames to the gateway go through a socket whose `send`
 * never blocks, so a local app emitting faster than the uplink drains would
 * grow this process's memory without bound. Above the high mark the upstream
 * is paused (its TCP window then pushes back on the app) until the queue
 * drains below the low mark. The hard cap is a backstop for a queue that
 * keeps growing anyway — it closes the tunnel with 1013 "try again later".
 */
export const WS_RELAY_HIGH_WATER = 4 * 1024 * 1024;
export const WS_RELAY_LOW_WATER = 1024 * 1024;
export const WS_RELAY_HARD_LIMIT = 32 * 1024 * 1024;
const WS_RELAY_DRAIN_POLL_MS = 50;

interface WsTunnel {
  closed: boolean;
  connId: string;
  /** Polls the backlog while the upstream is paused. */
  drainTimer?: ReturnType<typeof setInterval>;
  opened: boolean;
  /** Set once the loopback address is resolved and the dial has started. */
  socket?: TunnelUpstreamSocket;
}

export class DeviceWsTunnelHost {
  private tunnels = new Map<string, WsTunnel>();

  constructor(
    private options: {
      /** Bytes queued on the gateway socket but not yet written out. */
      backlog?: () => number;
      createSocket?: TunnelUpstreamFactory;
      logger: GatewayClientLogger;
      loopback?: LoopbackResolver;
      send: (frame: TunnelClientFrame) => void;
    },
  ) {}

  get activeCount(): number {
    return this.tunnels.size;
  }

  open(frame: TunnelWsOpenMessage): void {
    const { connId } = frame;
    if (this.tunnels.has(connId)) return;
    // Registered before the async dial, so a close that races it still lands.
    const tunnel: WsTunnel = { closed: false, connId, opened: false };
    this.tunnels.set(connId, tunnel);
    void this.dial(tunnel, frame);
  }

  private async dial(tunnel: WsTunnel, frame: TunnelWsOpenMessage): Promise<void> {
    const { connId, head, target } = frame;
    // `localhost` dev servers often listen on `::1` only; see LoopbackResolver.
    const host = this.options.loopback ? await this.options.loopback.resolve(target) : target.host;
    if (tunnel.closed) return;

    // An IPv6 literal needs brackets or the URL is invalid.
    const authority = host.includes(':') ? `[${host}]` : host;
    let socket: TunnelUpstreamSocket;
    try {
      socket = (this.options.createSocket ?? defaultFactory)(
        `ws://${authority}:${target.port}${head.path}`,
        head.protocols,
      );
    } catch (error) {
      this.release(tunnel);
      this.fail(connId, error);
      return;
    }
    tunnel.socket = socket;

    socket.on('open', () => {
      tunnel.opened = true;
      this.options.send({
        connId,
        ok: true,
        ...(socket.protocol ? { protocol: socket.protocol } : {}),
        type: 'tunnel_ws_open_ack',
      });
    });

    socket.on('message', (data, isBinary) => {
      if (tunnel.closed) return;
      this.options.send({
        ...(isBinary ? { binary: true } : {}),
        connId,
        data: isBinary ? data.toString('base64') : data.toString('utf8'),
        type: 'tunnel_ws_message',
      });
      this.applyBackpressure(tunnel);
    });

    // A dial that never completed may have hit the wrong loopback address (the
    // server restarted on the other family); drop the cached answer so the
    // next attempt — HMR reconnects right away — probes again.
    const forgetHost = () => this.options.loopback?.forget(target.port);

    socket.on('close', (code, reason) => {
      if (tunnel.closed) return;
      this.release(tunnel);
      if (!tunnel.opened) {
        forgetHost();
        this.options.send({
          connId,
          error: 'UPSTREAM_CLOSED',
          ok: false,
          type: 'tunnel_ws_open_ack',
        });
        return;
      }
      this.options.send({ code, connId, reason: reason.toString('utf8'), type: 'tunnel_ws_close' });
    });

    socket.on('error', (error) => {
      if (tunnel.closed) return;
      // Before the handshake completes the gateway is still waiting on an ack;
      // after it, the browser needs a close.
      if (!tunnel.opened) {
        forgetHost();
        this.release(tunnel);
        this.fail(connId, error);
        return;
      }
      this.options.logger.warn(`[tunnel] ws ${connId} upstream error: ${error.message}`);
    });
  }

  /** A browser message for the upstream socket. */
  message(frame: TunnelWsDataMessage): void {
    const tunnel = this.tunnels.get(frame.connId);
    if (!tunnel?.socket || tunnel.closed || !tunnel.opened) return;
    tunnel.socket.send(frame.binary ? Buffer.from(frame.data, 'base64') : frame.data);
  }

  /** The browser side closed; close upstream to match. */
  close(frame: TunnelWsCloseMessage): void {
    const tunnel = this.tunnels.get(frame.connId);
    if (!tunnel || tunnel.closed) return;
    this.release(tunnel);
    try {
      tunnel.socket?.close(sendableCode(frame.code), (frame.reason ?? '').slice(0, 100));
    } catch {
      tunnel.socket?.terminate();
    }
  }

  /** Drop every upstream socket, e.g. when the device socket goes away. */
  closeAll(): void {
    for (const tunnel of this.tunnels.values()) {
      this.release(tunnel);
      tunnel.socket?.terminate();
    }
  }

  // ─── internals ───

  private applyBackpressure(tunnel: WsTunnel): void {
    const backlog = this.options.backlog?.() ?? 0;

    if (backlog > WS_RELAY_HARD_LIMIT) {
      this.options.logger.warn(`[tunnel] ws ${tunnel.connId} relay backlog ${backlog}B, closing`);
      this.release(tunnel);
      tunnel.socket?.close(1013, 'RELAY_BACKLOG');
      this.options.send({
        code: 1013,
        connId: tunnel.connId,
        reason: 'RELAY_BACKLOG',
        type: 'tunnel_ws_close',
      });
      return;
    }

    if (backlog <= WS_RELAY_HIGH_WATER || tunnel.drainTimer) return;

    tunnel.socket?.pause();
    tunnel.drainTimer = setInterval(() => {
      if (tunnel.closed) return;
      if ((this.options.backlog?.() ?? 0) > WS_RELAY_LOW_WATER) return;
      clearInterval(tunnel.drainTimer);
      tunnel.drainTimer = undefined;
      tunnel.socket?.resume();
    }, WS_RELAY_DRAIN_POLL_MS);
  }

  /** Mark closed, forget it, and stop any drain polling. */
  private release(tunnel: WsTunnel): void {
    tunnel.closed = true;
    this.tunnels.delete(tunnel.connId);
    if (tunnel.drainTimer) {
      clearInterval(tunnel.drainTimer);
      tunnel.drainTimer = undefined;
    }
  }

  private fail(connId: string, error: unknown) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code: unknown }).code)
        : undefined;
    this.options.send({
      connId,
      error: code ?? (error instanceof Error ? error.message : 'TUNNEL_WS_OPEN_FAILED'),
      ok: false,
      type: 'tunnel_ws_open_ack',
    });
  }
}
