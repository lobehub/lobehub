import { Buffer } from 'node:buffer';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type WebSocket as ServerSocket, WebSocketServer } from 'ws';

import { LoopbackResolver } from './loopback';
import { DeviceTunnelHost } from './tunnel';
import type { TunnelClientFrame } from './types';
import { WS_RELAY_HARD_LIMIT, WS_RELAY_HIGH_WATER, WS_RELAY_LOW_WATER } from './wsTunnel';

// A real upstream WebSocket server, standing in for a dev server's HMR socket.
let server: WebSocketServer;
let port: number;
const connections: { protocol: string; socket: ServerSocket; url: string }[] = [];

beforeAll(async () => {
  server = new WebSocketServer({
    handleProtocols: (protocols) => (protocols.has('vite-hmr') ? 'vite-hmr' : false),
    host: '127.0.0.1',
    port: 0,
  });
  server.on('connection', (socket, request) => {
    connections.push({ protocol: socket.protocol, socket, url: request.url ?? '' });
    socket.on('message', (data, isBinary) => {
      // Echo, so relays in both directions are observable.
      socket.send(isBinary ? data : `echo:${data.toString()}`, { binary: isBinary });
    });
  });
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  for (const client of server.clients) client.terminate();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const waitFor = async (predicate: () => boolean, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const setup = () => {
  const frames: TunnelClientFrame[] = [];
  const host = new DeviceTunnelHost({ send: (frame) => frames.push(frame) });
  const of = <T extends TunnelClientFrame['type']>(type: T) =>
    frames.filter((f) => f.type === type) as Extract<TunnelClientFrame, { type: T }>[];
  return { frames, host, of };
};

const open = (host: DeviceTunnelHost, connId: string, overrides: Record<string, unknown> = {}) =>
  host.handleFrame({
    connId,
    head: { path: '/?token=vite-token', protocols: ['vite-hmr'] },
    target: { host: '127.0.0.1', port },
    type: 'tunnel_ws_open',
    ...overrides,
  } as never);

describe('WebSocket tunnels', () => {
  it('opens upstream with the path and subprotocol, and acks with the chosen protocol', async () => {
    const { host, of } = setup();
    open(host, 'w1');

    await waitFor(() => of('tunnel_ws_open_ack').length === 1);
    expect(of('tunnel_ws_open_ack')[0]).toEqual({
      connId: 'w1',
      ok: true,
      protocol: 'vite-hmr',
      type: 'tunnel_ws_open_ack',
    });
    // The app's own `?token=` reaches it untouched.
    expect(connections.at(-1)).toMatchObject({ protocol: 'vite-hmr', url: '/?token=vite-token' });
    host.closeAll('TEST');
  });

  it('relays text and binary messages both ways', async () => {
    const { host, of } = setup();
    open(host, 'w2');
    await waitFor(() => of('tunnel_ws_open_ack').length === 1);

    host.handleFrame({ connId: 'w2', data: '{"type":"ping"}', type: 'tunnel_ws_message' });
    await waitFor(() => of('tunnel_ws_message').length === 1);
    expect(of('tunnel_ws_message')[0]).toEqual({
      connId: 'w2',
      data: 'echo:{"type":"ping"}',
      type: 'tunnel_ws_message',
    });

    host.handleFrame({
      binary: true,
      connId: 'w2',
      data: Buffer.from([1, 2, 3]).toString('base64'),
      type: 'tunnel_ws_message',
    });
    await waitFor(() => of('tunnel_ws_message').length === 2);
    const echoed = of('tunnel_ws_message')[1];
    expect(echoed.binary).toBe(true);
    expect([...Buffer.from(echoed.data, 'base64')]).toEqual([1, 2, 3]);
    host.closeAll('TEST');
  });

  it('closes upstream when the browser closes', async () => {
    const { host, of } = setup();
    open(host, 'w3');
    await waitFor(() => of('tunnel_ws_open_ack').length === 1);
    const upstream = connections.at(-1)!.socket;

    const closed = new Promise<number>((resolve) =>
      upstream.once('close', (code) => resolve(code)),
    );
    host.handleFrame({ code: 1001, connId: 'w3', reason: 'tab closed', type: 'tunnel_ws_close' });

    expect(await closed).toBe(1001);
    expect(host.activeCount).toBe(0);
  });

  it('tells the gateway when the upstream closes', async () => {
    const { host, of } = setup();
    open(host, 'w4');
    await waitFor(() => of('tunnel_ws_open_ack').length === 1);

    connections.at(-1)!.socket.close(4000, 'server restart');

    await waitFor(() => of('tunnel_ws_close').length === 1);
    expect(of('tunnel_ws_close')[0]).toEqual({
      code: 4000,
      connId: 'w4',
      reason: 'server restart',
      type: 'tunnel_ws_close',
    });
  });

  it('fails the open when nothing listens, instead of hanging the handshake', async () => {
    const { host, of } = setup();
    open(host, 'w5', { target: { host: '127.0.0.1', port: 1 } });

    await waitFor(() => of('tunnel_ws_open_ack').length === 1);
    expect(of('tunnel_ws_open_ack')[0]).toMatchObject({ connId: 'w5', ok: false });
    expect(host.activeCount).toBe(0);
  });

  it('refuses a non-loopback target without dialing out', () => {
    const { host, of } = setup();
    open(host, 'w6', { target: { host: '10.0.0.5', port } });

    expect(of('tunnel_ws_open_ack')).toEqual([
      { connId: 'w6', error: 'TUNNEL_TARGET_NOT_LOOPBACK', ok: false, type: 'tunnel_ws_open_ack' },
    ]);
  });

  it('counts sockets against the shared concurrency limit', async () => {
    const frames: TunnelClientFrame[] = [];
    const host = new DeviceTunnelHost({ maxConcurrent: 1, send: (frame) => frames.push(frame) });
    open(host, 'w7');
    open(host, 'w8');

    expect(frames).toContainEqual({
      connId: 'w8',
      error: 'TUNNEL_LIMIT_REACHED',
      ok: false,
      type: 'tunnel_ws_open_ack',
    });
    host.closeAll('TEST');
  });

  it('drops every upstream socket when the device disconnects', async () => {
    const { host, of } = setup();
    open(host, 'w9');
    await waitFor(() => of('tunnel_ws_open_ack').length === 1);
    const upstream = connections.at(-1)!.socket;
    const closed = new Promise<void>((resolve) => upstream.once('close', () => resolve()));

    host.closeAll('DEVICE_DISCONNECTED');

    await closed;
    expect(host.activeCount).toBe(0);
  });
});

describe('WebSocket relay backpressure', () => {
  /** A fake upstream whose events the test fires by hand. */
  const fakeUpstream = () => {
    const handlers: Record<string, (...args: any[]) => void> = {};
    const socket = {
      close: vi.fn(),
      on: (event: string, listener: (...args: any[]) => void) => {
        handlers[event] = listener;
      },
      pause: vi.fn(),
      protocol: '',
      resume: vi.fn(),
      send: vi.fn(),
      terminate: vi.fn(),
    };
    return { emit: (event: string, ...args: any[]) => handlers[event]?.(...args), socket };
  };

  const setupFake = async () => {
    const upstream = fakeUpstream();
    const backlog = { value: 0 };
    const frames: TunnelClientFrame[] = [];
    const host = new DeviceTunnelHost({
      backlog: () => backlog.value,
      createUpstreamSocket: () => upstream.socket as never,
      // No real TCP probe under fake timers.
      loopback: new LoopbackResolver(async () => true),
      send: (frame) => frames.push(frame),
    });
    open(host, 'b1');
    // The dial runs after the (async) loopback resolution.
    await vi.waitFor(() => expect(upstream.socket).toBeDefined());
    await Promise.resolve();
    await Promise.resolve();
    upstream.emit('open');
    return { backlog, frames, host, upstream };
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('pauses a fast producer above the high mark and resumes once drained', async () => {
    const { backlog, host, upstream } = await setupFake();

    backlog.value = WS_RELAY_HIGH_WATER + 1;
    upstream.emit('message', Buffer.from('hmr update'), false);
    expect(upstream.socket.pause).toHaveBeenCalledTimes(1);

    // Still above the low mark: stays paused.
    backlog.value = WS_RELAY_LOW_WATER + 1;
    vi.advanceTimersByTime(200);
    expect(upstream.socket.resume).not.toHaveBeenCalled();

    backlog.value = 0;
    vi.advanceTimersByTime(100);
    expect(upstream.socket.resume).toHaveBeenCalledTimes(1);
    host.closeAll('TEST');
  });

  it('keeps relaying without pausing while the uplink keeps up', async () => {
    const { backlog, frames, host, upstream } = await setupFake();

    backlog.value = 1024;
    upstream.emit('message', Buffer.from('a'), false);
    upstream.emit('message', Buffer.from('b'), false);

    expect(upstream.socket.pause).not.toHaveBeenCalled();
    expect(frames.filter((f) => f.type === 'tunnel_ws_message')).toHaveLength(2);
    host.closeAll('TEST');
  });

  it('closes with 1013 when the backlog blows past the hard cap', async () => {
    const { backlog, frames, host, upstream } = await setupFake();

    backlog.value = WS_RELAY_HARD_LIMIT + 1;
    upstream.emit('message', Buffer.from('x'), false);

    expect(upstream.socket.close).toHaveBeenCalledWith(1013, 'RELAY_BACKLOG');
    expect(frames).toContainEqual({
      code: 1013,
      connId: 'b1',
      reason: 'RELAY_BACKLOG',
      type: 'tunnel_ws_close',
    });
    expect(host.activeCount).toBe(0);
  });

  it('stops polling the backlog once the tunnel is gone', async () => {
    const { backlog, host, upstream } = await setupFake();

    backlog.value = WS_RELAY_HIGH_WATER + 1;
    upstream.emit('message', Buffer.from('x'), false);
    host.closeAll('DEVICE_DISCONNECTED');

    backlog.value = 0;
    vi.advanceTimersByTime(500);
    // A closed tunnel must not be resumed by a leftover timer.
    expect(upstream.socket.resume).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
