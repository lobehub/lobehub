import { Buffer } from 'node:buffer';

import WebSocket from 'ws';

import type { GatewayClientLogger } from './client';
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
  readonly protocol: string;
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

interface WsTunnel {
  closed: boolean;
  connId: string;
  opened: boolean;
  socket: TunnelUpstreamSocket;
}

export class DeviceWsTunnelHost {
  private tunnels = new Map<string, WsTunnel>();

  constructor(
    private options: {
      createSocket?: TunnelUpstreamFactory;
      logger: GatewayClientLogger;
      send: (frame: TunnelClientFrame) => void;
    },
  ) {}

  get activeCount(): number {
    return this.tunnels.size;
  }

  open(frame: TunnelWsOpenMessage): void {
    const { connId, head, target } = frame;
    if (this.tunnels.has(connId)) return;

    // An IPv6 literal needs brackets or the URL is invalid.
    const authority = target.host.includes(':') ? `[${target.host}]` : target.host;
    let socket: TunnelUpstreamSocket;
    try {
      socket = (this.options.createSocket ?? defaultFactory)(
        `ws://${authority}:${target.port}${head.path}`,
        head.protocols,
      );
    } catch (error) {
      this.fail(connId, error);
      return;
    }

    const tunnel: WsTunnel = { closed: false, connId, opened: false, socket };
    this.tunnels.set(connId, tunnel);

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
    });

    socket.on('close', (code, reason) => {
      if (tunnel.closed) return;
      tunnel.closed = true;
      this.tunnels.delete(connId);
      if (!tunnel.opened) {
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
        tunnel.closed = true;
        this.tunnels.delete(connId);
        this.fail(connId, error);
        return;
      }
      this.options.logger.warn(`[tunnel] ws ${connId} upstream error: ${error.message}`);
    });
  }

  /** A browser message for the upstream socket. */
  message(frame: TunnelWsDataMessage): void {
    const tunnel = this.tunnels.get(frame.connId);
    if (!tunnel || tunnel.closed || !tunnel.opened) return;
    tunnel.socket.send(frame.binary ? Buffer.from(frame.data, 'base64') : frame.data);
  }

  /** The browser side closed; close upstream to match. */
  close(frame: TunnelWsCloseMessage): void {
    const tunnel = this.tunnels.get(frame.connId);
    if (!tunnel || tunnel.closed) return;
    tunnel.closed = true;
    this.tunnels.delete(frame.connId);
    try {
      tunnel.socket.close(sendableCode(frame.code), (frame.reason ?? '').slice(0, 100));
    } catch {
      tunnel.socket.terminate();
    }
  }

  /** Drop every upstream socket, e.g. when the device socket goes away. */
  closeAll(): void {
    for (const tunnel of this.tunnels.values()) {
      tunnel.closed = true;
      tunnel.socket.terminate();
    }
    this.tunnels.clear();
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
