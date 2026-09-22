import { Buffer } from 'node:buffer';
import http from 'node:http';
import type { Socket } from 'node:net';
import { gzipSync } from 'node:zlib';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DeviceTunnelHost } from './tunnel';
import type { TunnelClientFrame, TunnelOpenMessage } from './types';
import { TUNNEL_CHUNK_SIZE, TUNNEL_FLOW_WINDOW } from './types';

let server: http.Server;
let port: number;
/** Requests the origin saw torn down early, so aborts are observable. */
const aborted: string[] = [];
/** Requests the origin actually received, so tests don't abort before dispatch. */
const received: string[] = [];
const sockets = new Set<Socket>();

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url!, 'http://127.0.0.1');
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<h1>origin</h1>');
      return;
    }
    if (url.pathname === '/echo') {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        res.end(Buffer.concat(chunks));
      });
      return;
    }
    if (url.pathname === '/cookies') {
      res.writeHead(200, {
        'content-type': 'text/plain',
        'set-cookie': ['a=1; Path=/', 'b=2; Path=/'],
      });
      res.end('ok');
      return;
    }
    if (url.pathname === '/gzip') {
      const payload = gzipSync(Buffer.from('compressed-payload'));
      res.writeHead(200, { 'content-encoding': 'gzip', 'content-type': 'text/plain' });
      res.end(payload);
      return;
    }
    if (url.pathname === '/redirect') {
      res.writeHead(302, { location: '/elsewhere' });
      res.end();
      return;
    }
    if (url.pathname === '/big') {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(Buffer.alloc(2 * 1024 * 1024, 0x61));
      return;
    }
    if (url.pathname === '/hang') {
      received.push('/hang');
      // Fires when the connection goes away before a response was written.
      res.on('close', () => aborted.push('/hang'));
      return; // never responds
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not here');
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  // `/hang` deliberately leaves requests open; close() would wait on them.
  for (const socket of sockets) socket.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const openFrame = (
  connId: string,
  path: string,
  overrides: Partial<TunnelOpenMessage> = {},
): TunnelOpenMessage => ({
  connId,
  head: { headers: [], method: 'GET', path },
  target: { host: '127.0.0.1', port },
  type: 'tunnel_open',
  ...overrides,
});

const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const waitFor = async (predicate: () => boolean, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

/** Collects everything the device sends up, and replays the gateway's acks. */
const createHost = (options: { autoAck?: boolean } = {}) => {
  const frames: TunnelClientFrame[] = [];
  const host = new DeviceTunnelHost({
    send: (frame) => {
      frames.push(frame);
      // The real gateway acks response bytes as the browser pulls them.
      if (options.autoAck !== false && frame.type === 'tunnel_data' && frame.data) {
        const bytes = Buffer.from(frame.data, 'base64').byteLength;
        queueMicrotask(() => host.handleFrame({ bytes, connId: frame.connId, type: 'tunnel_ack' }));
      }
    },
  });
  const bodyOf = (connId: string) =>
    Buffer.concat(
      frames
        .filter((f) => f.type === 'tunnel_data' && f.connId === connId && f.data)
        .map((f) => Buffer.from((f as { data: string }).data, 'base64')),
    );
  const finished = (connId: string) =>
    frames.some((f) => f.type === 'tunnel_data' && f.connId === connId && f.fin);
  return { bodyOf, finished, frames, host };
};

describe('DeviceTunnelHost', () => {
  it('serves a GET and streams the response back', async () => {
    const { bodyOf, finished, frames, host } = createHost();
    host.handleFrame(openFrame('c1', '/'));
    // The gateway always closes the upload side, even with no body.
    host.handleFrame({ connId: 'c1', data: '', fin: true, seq: 1, type: 'tunnel_data' });

    await waitFor(() => finished('c1'));

    const ack = frames.find((f) => f.type === 'tunnel_open_ack');
    expect(ack).toMatchObject({ ok: true });
    expect((ack as { head: { status: number } }).head.status).toBe(200);
    expect(bodyOf('c1').toString()).toBe('<h1>origin</h1>');
    expect(host.activeCount).toBe(0);
  });

  it('passes an upstream 404 through instead of erroring', async () => {
    const { bodyOf, finished, frames, host } = createHost();
    host.handleFrame(openFrame('c1', '/missing'));
    host.handleFrame({ connId: 'c1', data: '', fin: true, seq: 1, type: 'tunnel_data' });

    await waitFor(() => finished('c1'));

    expect(frames.find((f) => f.type === 'tunnel_open_ack')).toMatchObject({
      head: { status: 404 },
      ok: true,
    });
    expect(bodyOf('c1').toString()).toBe('not here');
  });

  it('streams a POST body up and acks the bytes it consumed', async () => {
    const { bodyOf, finished, frames, host } = createHost();
    host.handleFrame(
      openFrame('c1', '/echo', { head: { headers: [], method: 'POST', path: '/echo' } }),
    );
    const payload = Buffer.from('request-body-over-the-tunnel');
    host.handleFrame({
      connId: 'c1',
      data: payload.toString('base64'),
      seq: 1,
      type: 'tunnel_data',
    });
    host.handleFrame({ connId: 'c1', data: '', fin: true, seq: 2, type: 'tunnel_data' });

    await waitFor(() => finished('c1'));

    expect(bodyOf('c1').toString()).toBe('request-body-over-the-tunnel');
    // Flow control: the gateway's send window must be refilled.
    expect(frames.filter((f) => f.type === 'tunnel_ack')).toEqual([
      { bytes: payload.byteLength, connId: 'c1', type: 'tunnel_ack' },
    ]);
  });

  it('keeps each set-cookie header separate', async () => {
    const { finished, frames, host } = createHost();
    host.handleFrame(openFrame('c1', '/cookies'));
    host.handleFrame({ connId: 'c1', data: '', fin: true, seq: 1, type: 'tunnel_data' });

    await waitFor(() => finished('c1'));

    const ack = frames.find((f) => f.type === 'tunnel_open_ack') as {
      head: { headers: [string, string][] };
    };
    const cookies = ack.head.headers.filter(([name]) => name.toLowerCase() === 'set-cookie');
    expect(cookies.map(([, value]) => value)).toEqual(['a=1; Path=/', 'b=2; Path=/']);
  });

  it('drops content-encoding because the body is forwarded decoded', async () => {
    const { bodyOf, finished, frames, host } = createHost();
    host.handleFrame(openFrame('c1', '/gzip'));
    host.handleFrame({ connId: 'c1', data: '', fin: true, seq: 1, type: 'tunnel_data' });

    await waitFor(() => finished('c1'));

    const ack = frames.find((f) => f.type === 'tunnel_open_ack') as {
      head: { headers: [string, string][] };
    };
    expect(ack.head.headers.map(([name]) => name.toLowerCase())).not.toContain('content-encoding');
    expect(bodyOf('c1').toString()).toBe('compressed-payload');
  });

  it('hands a redirect to the browser instead of following it', async () => {
    const { finished, frames, host } = createHost();
    host.handleFrame(openFrame('c1', '/redirect'));
    host.handleFrame({ connId: 'c1', data: '', fin: true, seq: 1, type: 'tunnel_data' });

    await waitFor(() => finished('c1'));

    const ack = frames.find((f) => f.type === 'tunnel_open_ack') as {
      head: { headers: [string, string][]; status: number };
    };
    expect(ack.head.status).toBe(302);
    expect(ack.head.headers).toContainEqual(['location', '/elsewhere']);
  });

  it('pauses the response once the flow window is full and resumes on ack', async () => {
    const { frames, host } = createHost({ autoAck: false });
    host.handleFrame(openFrame('c1', '/big'));
    host.handleFrame({ connId: 'c1', data: '', fin: true, seq: 1, type: 'tunnel_data' });

    // Frame sizes follow whatever the upstream reader yields, so the window is
    // measured in bytes, not frames.
    const bytesSent = () =>
      frames
        .filter((f) => f.type === 'tunnel_data' && f.data)
        .reduce(
          (total, f) => total + Buffer.from((f as { data: string }).data, 'base64').byteLength,
          0,
        );

    await waitFor(() => bytesSent() >= TUNNEL_FLOW_WINDOW);
    await nextTick();
    await nextTick();
    const stalledAt = bytesSent();
    // At most one frame may overshoot: the window is checked before each send.
    expect(stalledAt).toBeLessThan(TUNNEL_FLOW_WINDOW + TUNNEL_CHUNK_SIZE);

    host.handleFrame({ bytes: TUNNEL_FLOW_WINDOW, connId: 'c1', type: 'tunnel_ack' });
    await waitFor(() => bytesSent() > stalledAt);
    expect(bytesSent()).toBeLessThan(stalledAt + TUNNEL_FLOW_WINDOW + TUNNEL_CHUNK_SIZE);
  });

  it('rejects a non-loopback target', async () => {
    const { frames, host } = createHost();
    host.handleFrame(openFrame('c1', '/', { target: { host: '10.0.0.5', port } }));
    expect(frames).toEqual([
      { connId: 'c1', error: 'TUNNEL_TARGET_NOT_LOOPBACK', ok: false, type: 'tunnel_open_ack' },
    ]);
    expect(host.activeCount).toBe(0);
  });

  it('reports a refused connection as a failed open instead of hanging', async () => {
    const { frames, host } = createHost();
    // Port 1 is reserved and never listening in CI or locally.
    host.handleFrame(openFrame('c1', '/', { target: { host: '127.0.0.1', port: 1 } }));
    host.handleFrame({ connId: 'c1', data: '', fin: true, seq: 1, type: 'tunnel_data' });

    await waitFor(() => frames.some((f) => f.type === 'tunnel_open_ack'));
    expect(frames.find((f) => f.type === 'tunnel_open_ack')).toMatchObject({ ok: false });
    expect(host.activeCount).toBe(0);
  });

  it('rejects an open past the concurrency limit', async () => {
    const frames: TunnelClientFrame[] = [];
    const host = new DeviceTunnelHost({ maxConcurrent: 1, send: (f) => frames.push(f) });
    host.handleFrame(openFrame('c1', '/hang'));
    host.handleFrame(openFrame('c2', '/'));

    expect(frames).toContainEqual({
      connId: 'c2',
      error: 'TUNNEL_LIMIT_REACHED',
      ok: false,
      type: 'tunnel_open_ack',
    });
    host.closeAll('TEST_CLEANUP');
  });

  it('aborts the upstream request when the gateway closes the tunnel', async () => {
    const { host } = createHost();
    host.handleFrame(openFrame('c1', '/hang'));
    host.handleFrame({ connId: 'c1', data: '', fin: true, seq: 1, type: 'tunnel_data' });
    // Abort only once the origin is genuinely holding the request open.
    await waitFor(() => received.includes('/hang'));

    host.handleFrame({ connId: 'c1', reason: 'BROWSER_GONE', type: 'tunnel_close' });

    expect(host.activeCount).toBe(0);
    await waitFor(() => aborted.includes('/hang'));
  });

  it('closes every tunnel when the device socket drops', async () => {
    const { host } = createHost();
    host.handleFrame(openFrame('c1', '/hang'));
    host.handleFrame(openFrame('c2', '/hang'));
    await waitFor(() => host.activeCount === 2);

    host.closeAll('DEVICE_DISCONNECTED');

    expect(host.activeCount).toBe(0);
  });
});
