import { Buffer } from 'node:buffer';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type WebSocket as ServerSocket, WebSocketServer } from 'ws';

import { DeviceTunnelHost } from './tunnel';
import type { TunnelClientFrame } from './types';

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
